# -*- coding: utf-8 -*-
"""SH150 學校表單填報（school-form.js）在 408 版與全校通用版的本機驗收。

執行：python -m unittest discover -s tests -p test_school_form.py -v
只用虛構資料；Google 表單與 408 的 GAS 一律由 Playwright 攔截，不連正式表單、不寫入試算表。
"""
import functools, http.server, json, os, shutil, socketserver, tempfile, threading, unittest
from urllib.parse import urlparse, parse_qs

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORM = 'https://docs.google.com/forms/d/e/1FAIpQLScMjfAwV9ZSrQt0eS_qd9Aku18SX_txnINZXc6sE5lAQ3PX2Q/viewform'
CORE = {'teacherName': 'entry.1346505626', 'className': 'entry.1762303383',
        'studentTotal': 'entry.1337826514', 'teacherTotal': 'entry.1653264987'}


def compact(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def week_data(records, runs):
    return {'version': 2, 'currentWeek': 6, 'allWeeksData': {'6': {'records': records, 'teacherRuns': runs}}}


SAMPLE_RECORDS = {'1_1': {'run': 1, 'jump': 150}, '2_1': {'run': 2, 'jump': 100}, '3_2': {'run': 0, 'jump': 100}}
SAMPLE_RUNS = {'1': 2, '2': 1, '3': 0, '4': 0, '5': 0}


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix='sh150_form_')
        site = os.path.join(cls.tmp, 'sh150-tracker'); os.makedirs(site)
        for f in ['index.html', 'universal.html', 'school-form.js']:
            shutil.copy(os.path.join(ROOT, f), site)
        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a): pass
        cls.srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=cls.tmp))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = 'http://127.0.0.1:%d/sh150-tracker/' % cls.srv.server_address[1]
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.srv.shutdown()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def open(self, page_name, storage=None, viewport=(1366, 900)):
        ctx = self.browser.new_context(accept_downloads=True, viewport={'width': viewport[0], 'height': viewport[1]})
        self.addCleanup(ctx.close)
        self.opened, self.gas = [], []
        def google(route):
            self.opened.append(route.request.url)
            route.fulfill(status=200, content_type='text/html', body='<html><body>測試攔截</body></html>')
        def gas(route):
            self.gas.append(route.request.method)
            route.fulfill(status=503, content_type='application/json', body='{"status":"error","message":"測試攔截"}')
        ctx.route('https://docs.google.com/**', google)
        ctx.route('https://script.google.com/**', gas)
        ctx.route('https://script.googleusercontent.com/**', gas)
        ctx.add_init_script('(() => { if (sessionStorage.getItem("__seeded")) return; sessionStorage.setItem("__seeded", "1");'
                            ' const s = %s; for (const k in s) localStorage.setItem(k, s[k]); })()' % json.dumps(storage or {}, ensure_ascii=False))
        page = ctx.new_page()
        page._errs, page._dialogs = [], []
        page.on('pageerror', lambda e: page._errs.append(str(e)))
        page.on('dialog', lambda d: (page._dialogs.append(d.message), d.accept()))
        page.goto(self.base + page_name)
        page.wait_for_timeout(900)
        return page

    def storage(self, page):
        return page.evaluate("() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; }")

    def open_report(self, page):
        page.click('button:has-text("填報學校本週資料")')
        page.wait_for_selector('#sf-report-modal.sf-show')
        page.wait_for_timeout(200)

    def confirm(self, page):
        if page.is_visible('#sf-report-confirm'):
            page.check('#sf-report-confirm')

    def body(self, page):
        return page.inner_text('#sf-report-body')


UNIVERSAL_STORAGE = {
    'sh150_class_config': compact({'className': '101', 'teacherName': '示範 老師', 'leaderName': '甲、乙', 'studentCount': 30, 'studentNames': []}),
    'sh150_universal_all_records': compact(week_data(SAMPLE_RECORDS, SAMPLE_RUNS)),
}


class TestUniversal(Base):
    PAGE = 'universal.html'

    def goto_week6(self, page):
        page.fill('#weekNum', '6'); page.dispatch_event('#weekNum', 'change'); page.wait_for_timeout(200)

    def test_calc_and_prefill(self):
        p = self.open(self.PAGE, UNIVERSAL_STORAGE)
        self.goto_week6(p)
        self.open_report(p)
        b = self.body(p)
        self.assertIn('4 圈', b); self.assertIn('3 圈', b); self.assertIn('第 6 週', b); self.assertIn('115-1', b)
        self.confirm(p)
        with p.context.expect_page():
            p.click('#sf-report-open')
        q = parse_qs(urlparse(self.opened[0]).query)
        self.assertEqual(q[CORE['teacherName']], ['示範'])          # 「老師」字尾去掉
        self.assertEqual(q[CORE['className']], ['101'])
        self.assertEqual(q[CORE['studentTotal']], ['4'])
        self.assertEqual(q[CORE['teacherTotal']], ['3'])           # 不先乘 2
        self.assertIn('entry.682543904_hour', q)
        self.assertTrue(self.opened[0].startswith(FORM + '?'))
        self.assertEqual(p._errs, [])

    def test_default_class_blocks_prefill(self):
        p = self.open(self.PAGE)       # 沒有班級設定 → 4XX、OOO 老師
        self.open_report(p)
        b = self.body(p)
        self.assertIn('不在學校表單的選項', b); self.assertIn('導師姓名還是預設值', b)
        self.assertTrue(p.is_disabled('#sf-report-open'))
        self.assertTrue(p.is_visible('#sf-report-blank'))
        p.evaluate("() => { Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true}); }")
        p.click('#sf-report-copy'); p.wait_for_timeout(200)
        self.assertIn('班級：4XX', p.input_value('#sf-report-copytext'))

    def test_old_data_untouched(self):
        p = self.open(self.PAGE, UNIVERSAL_STORAGE)
        before = self.storage(p)
        self.goto_week6(p)
        before = self.storage(p)     # 切週時 SH150 原本就會重存當週，取切週後為基準
        self.open_report(p)
        p.click('#sf-report-copy')
        p.click('#sf-report-settings'); p.wait_for_timeout(200)
        p.click('#sf-form-body summary'); p.fill('#sf-form-classes', '101\n102')
        p.click('#sf-form-body button:has-text("儲存班級選項")'); p.wait_for_timeout(200)
        after = self.storage(p)
        changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
        self.assertEqual(changed, {'sh150_school_form_config'})
        for k in UNIVERSAL_STORAGE:
            self.assertEqual(after[k], before[k])
        p.click('#sf-form-reset'); p.wait_for_timeout(200)
        self.assertNotIn('sh150_school_form_config', self.storage(p))
        self.assertEqual({k: v for k, v in self.storage(p).items()}, before)

    def test_layout_version_print(self):
        p = self.open(self.PAGE, UNIVERSAL_STORAGE)
        btns = p.locator('.controls button').all_inner_texts()
        self.assertLess(btns.index('🖨️ A4 直接列印'), btns.index('📤 填報學校本週資料'))
        self.assertIn('第 18 版', p.inner_text('#appVersion'))
        self.open_report(p)
        p.emulate_media(media='print')
        self.assertTrue(p.is_hidden('#sf-report-modal'))
        p.emulate_media(media='screen')
        p.set_viewport_size({'width': 375, 'height': 740}); p.wait_for_timeout(200)
        for sel in ['#sf-report-open', '#sf-report-copy', '#sf-report-close']:
            box = p.locator(sel).bounding_box()
            self.assertTrue(box and box['x'] >= 0 and box['x'] + box['width'] <= 375, sel)

    def test_html_is_text(self):
        evil = '<img src=x onerror=window.hitT=1>'
        st = dict(UNIVERSAL_STORAGE, sh150_class_config=compact({'className': '101', 'teacherName': evil, 'studentCount': 30}))
        p = self.open(self.PAGE, st)
        self.open_report(p)
        self.assertIn(evil, self.body(p))
        self.assertFalse(p.evaluate('!!window.hitT'))


class Test408(Base):
    PAGE = 'index.html'

    def test_calc_prefill_and_no_cloud_write(self):
        st = {'408_sh150_records': compact(week_data(SAMPLE_RECORDS, SAMPLE_RUNS))}
        p = self.open(self.PAGE, st)
        before = self.storage(p)
        p.fill('#weekNum', '6'); p.dispatch_event('#weekNum', 'change'); p.wait_for_timeout(300)
        base = self.storage(p)
        gas_before = list(self.gas)
        self.open_report(p)
        b = self.body(p)
        self.assertIn('408', b); self.assertIn('4 圈', b); self.assertIn('3 圈', b)
        self.assertNotIn('導師姓名還是預設值', b)
        info = p.evaluate("() => document.querySelector('#sf-report-body').innerText")
        self.confirm(p)
        with p.context.expect_page():
            p.click('#sf-report-open')
        q = parse_qs(urlparse(self.opened[0]).query)
        self.assertEqual(q[CORE['className']], ['408'])
        self.assertEqual(q[CORE['studentTotal']], ['4']); self.assertEqual(q[CORE['teacherTotal']], ['3'])
        teacher = q[CORE['teacherName']][0]
        self.assertTrue(teacher and '老師' not in teacher and '｜' not in teacher, '導師姓名應從頁首取出')
        self.assertIn(teacher, info)
        # 填報功能本身不會觸發任何 GAS 請求，也不改 408 紀錄
        self.assertEqual(self.gas, gas_before)
        after = self.storage(p)
        self.assertEqual(after['408_sh150_records'], base['408_sh150_records'])
        self.assertEqual({k for k in set(base) | set(after) if base.get(k) != after.get(k)}, set())
        self.assertEqual(p._errs, [])

    def test_existing_buttons_still_work(self):
        p = self.open(self.PAGE)
        btns = p.locator('.controls button').all_inner_texts()
        self.assertLess(btns.index('🖨️ A4 直接列印'), btns.index('📤 填報學校本週資料'))
        p.click('button:has-text("下一週")'); p.wait_for_timeout(200)
        p.click('button:has-text("上一週")'); p.wait_for_timeout(200)
        self.assertGreater(p.locator('.student-card').count(), 20)
        self.assertEqual(p._errs, [])


if __name__ == '__main__':
    unittest.main()
