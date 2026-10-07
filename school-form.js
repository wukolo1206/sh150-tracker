// SH150 每週填報學校 Google 表單（408 版與全校通用版共用）
// 流程：所選週彙整 → 老師核對 → 開啟預填表單（或複製文字）→ 老師在 Google 表單補照片並自己按提交。
// 工具無法得知學校是否收到，只會說「已產生連結」。
// 本模組只讀寫 adapter.storageKey 這一個新 key；不寫入任何運動紀錄或班級設定。
// 計算與驗證邏輯與 classroom-timer/universal.html v1.7 的 ctuSchoolForm 相同。
(function () {
    'use strict';
    var MAX_URL = 16384, MAX_CONFIG = 65536;
    var LIMIT = { run: 50, jump: 10000, teacher: 50 };   // 登記畫面單筆上限，超過只警告不截斷
    var CORE = ['teacherName', 'className', 'studentTotal', 'teacherTotal'];
    var CORE_LABEL = { teacherName: '導師姓名', className: '班級', studentTotal: '學生當週總圈數', teacherTotal: '導師當週總圈數' };
    var DATE_PARTS = ['year', 'month', 'day', 'hour', 'minute'];
    var DATE_LABEL = { year: '填報日期－年', month: '填報日期－月', day: '填報日期－日', hour: '填報時間－時（24 小時）', minute: '填報時間－分' };
    var CLASS_OPTIONS = (function () {
        var out = [], max = { 1: 12, 2: 12, 3: 13, 4: 13, 5: 13, 6: 18 };
        for (var g = 1; g <= 6; g++) for (var c = 1; c <= max[g]; c++) out.push(String(g * 100 + c));
        return out;
    })();
    var DEFAULT_CONFIG = {
        schema: 1, revision: 1,
        formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScMjfAwV9ZSrQt0eS_qd9Aku18SX_txnINZXc6sE5lAQ3PX2Q/viewform',
        bindings: { teacherName: 'entry.1346505626', className: 'entry.1762303383', studentTotal: 'entry.1337826514', teacherTotal: 'entry.1653264987' },
        // 填報日期時間：年／月／日／時（24 小時）／分五個參數，2026-10-07 已在學校表單實測（含午夜、跨年）
        reportedAtBindings: { 'entry.682543904_year': 'year', 'entry.682543904_month': 'month', 'entry.682543904_day': 'day', 'entry.682543904_hour': 'hour', 'entry.682543904_minute': 'minute' },
        classOptions: CLASS_OPTIONS,
        // 維護者 2026-10-07 已用學校帳號實測四個欄位、日期時間與數字 0；換表單後會回到未核對
        verification: { status: 'verified', verifiedAt: '2026-10-07T00:00:00.000Z', reportedAt: 'verified' },
        updatedAt: null
    };

    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function readCount(v) {
        if (v === undefined || v === null || v === '') return 0;
        // 必須是安全整數；超長數字字串會變成 Infinity 或失去精度，一律視為有誤
        if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
        if (typeof v === 'string' && /^\d+$/.test(v.trim())) { var n = Number(v.trim()); return Number.isSafeInteger(n) ? n : null; }
        return null;
    }
    var DAYS = '一二三四五';

    // ── 純函式：所選週彙整（不讀寫任何儲存）──
    function summarizeWeek(snapshot, rosterCount, teacherExtraLaps) {
        var errors = [], warnings = [];
        var snap = isPlain(snapshot) ? snapshot : {};
        var records = isPlain(snap.records) ? snap.records : {};
        var runs = isPlain(snap.teacherRuns) ? snap.teacherRuns : {};
        var roster = parseInt(rosterCount, 10) || 0;
        var dates = Array.isArray(snap.dates) ? snap.dates : [];
        var daily = [];
        for (var d = 1; d <= 5; d++) {
            var dt = dates.filter(function (x) { return x && x.day === d; })[0];
            daily.push({ day: d, ymd: dt ? String(dt.ymd) : '', run: 0, jump: 0, jumpLaps: 0, teacherRun: 0 });
        }
        var outSeats = {}, hasRecords = false, overLimit = false;
        Object.keys(records).forEach(function (key) {
            var m = /^(\d+)_(\d+)$/.exec(key);
            var seat = m ? parseInt(m[1], 10) : 0, day = m ? parseInt(m[2], 10) : 0;
            if (!m || seat < 1 || day < 1 || day > 5) { warnings.push('紀錄「' + key + '」不是有效的座號與星期，未計入'); return; }
            var rec = records[key];
            if (!isPlain(rec)) { errors.push(seat + ' 號星期' + DAYS[day - 1] + '的紀錄格式有誤'); return; }
            var run = readCount(rec.run), jump = readCount(rec.jump);
            if (run === null) errors.push(seat + ' 號星期' + DAYS[day - 1] + '的跑步圈數有誤：' + String(rec.run));
            if (jump === null) errors.push(seat + ' 號星期' + DAYS[day - 1] + '的跳繩下數有誤：' + String(rec.jump));
            if (run === null || jump === null) return;
            if (run > LIMIT.run || jump > LIMIT.jump) overLimit = true;
            daily[day - 1].run += run;
            daily[day - 1].jump += jump;
            if (run > 0 || jump > 0) {
                hasRecords = true;
                if (roster && seat > roster) outSeats[seat] = true;
            }
        });
        Object.keys(runs).forEach(function (key) {
            var day = /^\d+$/.test(key) ? parseInt(key, 10) : 0;
            if (day < 1 || day > 5) { warnings.push('導師紀錄「' + key + '」不是有效的星期，未計入'); return; }
            var v = readCount(runs[key]);
            if (v === null) { errors.push('導師星期' + DAYS[day - 1] + '的跑步圈數有誤：' + String(runs[key])); return; }
            if (v > LIMIT.teacher) overLimit = true;
            daily[day - 1].teacherRun += v;
            if (v > 0) hasRecords = true;
        });
        var extra = readCount(teacherExtraLaps);
        if (extra === null) { errors.push('導師額外換算圈數要填 0 或正整數'); extra = 0; }
        var t = { run: 0, jump: 0, laps: 0, teacher: 0 };
        daily.forEach(function (x) {
            x.jumpLaps = Math.floor(x.jump / 200);       // 先全班當天加總，再每 200 下換 1 圈
            t.run += x.run; t.jump += x.jump; t.laps += x.jumpLaps; t.teacher += x.teacherRun;
        });
        if (![t.run, t.jump, t.laps, t.teacher, t.run + t.laps, t.teacher + extra].every(Number.isSafeInteger)) errors.push('合計數字過大，請檢查紀錄');
        var out = Object.keys(outSeats).map(Number).sort(function (a, b) { return a - b; });
        if (out.length) warnings.push('座號 ' + out.join('、') + ' 不在目前名冊（' + roster + ' 人）內，但這週有運動紀錄，已計入；請核對');
        if (overLimit) warnings.push('有單筆數字超過登記畫面的上限（跑步 50 圈、跳繩 10000 下），已照原數計入；請核對');
        if (!hasRecords) warnings.push('目前沒有本週紀錄，數字都是 0；請確認是否已登記');
        return {
            week: parseInt(snap.week, 10) || 0, dates: dates.map(function (x) { return x && x.ymd; }), daily: daily,
            studentRunTotal: t.run, studentJumpTotal: t.jump, studentJumpLaps: t.laps, studentTotal: t.run + t.laps,
            teacherRunTotal: t.teacher, teacherExtraLaps: extra, teacherTotal: t.teacher + extra,
            recordedOutOfRosterSeats: out, hasRecords: hasRecords, warnings: warnings, errors: errors
        };
    }

    function normalizeFormUrl(text) {
        var raw = String(text == null ? '' : text).trim();
        if (!raw) return { error: '請貼上學校表單網址' };
        if (raw.length > MAX_URL) return { error: '網址太長（超過 16 KiB）' };
        var u;
        try { u = new URL(raw); } catch (e) { return { error: '不是有效的網址' }; }
        if (u.hostname === 'forms.gle') return { error: '這是短網址：請先在瀏覽器開啟，再複製網址列上的完整作答者網址（docs.google.com 開頭）' };
        if (u.protocol !== 'https:') return { error: '網址必須是 https 開頭' };
        if (u.hostname !== 'docs.google.com') return { error: '只接受 docs.google.com 的 Google 表單網址' };
        if (u.username || u.password) return { error: '網址不可含帳號密碼' };
        if (u.port) return { error: '網址不可指定連接埠' };
        var m = /^\/forms\/(?:u\/\d+\/)?d\/e\/([A-Za-z0-9_-]{20,})\/viewform\/?$/.exec(u.pathname);
        if (!m) return { error: '請貼「作答者」網址（結尾是 /viewform），不是編輯或回覆網址' };
        return { formId: m[1], formUrl: 'https://docs.google.com/forms/d/e/' + m[1] + '/viewform', url: u };
    }
    function validEntry(v) { return typeof v === 'string' && /^entry\.[1-9]\d{0,14}$/.test(v); }
    function validDateParam(v) { return typeof v === 'string' && /^entry\.[1-9]\d{0,14}(_(year|month|day|hour|minute))?$/.test(v); }

    function validateConfig(config) {
        var errors = [], warnings = [];
        if (!isPlain(config)) return { valid: false, errors: ['設定必須是物件'], warnings: warnings, normalized: null };
        var size = 0;
        try { size = JSON.stringify(config).length; } catch (e) { size = Infinity; }
        if (size > MAX_CONFIG) errors.push('設定太大（超過 64 KiB）');
        if (config.schema !== 1) errors.push('設定版本不支援（schema ' + String(config.schema) + '）');
        var form = normalizeFormUrl(config.formUrl);
        if (form.error) errors.push('表單網址：' + form.error);
        var b = isPlain(config.bindings) ? config.bindings : {};
        var used = {};
        CORE.forEach(function (k) {
            if (!validEntry(b[k])) errors.push(CORE_LABEL[k] + '的欄位對應缺少或格式錯誤');
            else if (used[b[k]]) errors.push(CORE_LABEL[k] + '和' + CORE_LABEL[used[b[k]]] + '對應到同一個欄位');
            else used[b[k]] = k;
        });
        var ra = isPlain(config.reportedAtBindings) ? config.reportedAtBindings : (config.reportedAtBindings === undefined ? {} : null);
        if (ra === null) { errors.push('填報日期的欄位對應格式錯誤'); ra = {}; }
        var raOut = {}, partUsed = {}, dateBases = {};
        Object.keys(ra).forEach(function (param) {
            var part = ra[param];
            if (!validDateParam(param) || DATE_PARTS.indexOf(part) < 0) { errors.push('填報日期對應「' + param + '」格式錯誤'); return; }
            // 參數尾碼必須和角色一致，例如 _month 只能對應「月」
            var sfx = /_([a-z]+)$/.exec(param);
            if (!sfx || sfx[1] !== part) { errors.push('填報日期對應「' + param + '」和「' + DATE_LABEL[part] + '」不一致'); return; }
            var base = param.replace(/_[a-z]+$/, '');
            if (used[param] || used[base]) { errors.push('填報日期對應「' + param + '」和其他欄位衝突'); return; }
            if (partUsed[part]) { errors.push('填報日期的「' + DATE_LABEL[part] + '」重複對應'); return; }
            partUsed[part] = true; raOut[param] = part; dateBases[base] = true;
        });
        // 自動帶入日期時間：年、月、日、時、分五個部分都要有，且屬於同一題
        var dateComplete = DATE_PARTS.every(function (x) { return partUsed[x]; }) && Object.keys(dateBases).length === 1;
        var opts = Array.isArray(config.classOptions) ? config.classOptions : null;
        if (!opts || !opts.length) errors.push('班級選項不可空白');
        else {
            var seen = {};
            opts.forEach(function (o) {
                if (typeof o !== 'string' || !o.trim() || o.length > 20) errors.push('班級選項格式錯誤：' + String(o));
                else if (seen[o]) errors.push('班級選項重複：' + o);
                else seen[o] = true;
            });
        }
        var ver = isPlain(config.verification) ? config.verification : {};
        var normalized = errors.length ? null : {
            schema: 1,
            revision: parseInt(config.revision, 10) > 0 ? parseInt(config.revision, 10) : 1,
            formUrl: form.formUrl,
            bindings: { teacherName: b.teacherName, className: b.className, studentTotal: b.studentTotal, teacherTotal: b.teacherTotal },
            reportedAtBindings: raOut,
            classOptions: opts.slice(),
            verification: {
                status: ver.status === 'verified' ? 'verified' : 'unverified',
                verifiedAt: typeof ver.verifiedAt === 'string' ? ver.verifiedAt : null,
                reportedAt: ver.reportedAt === 'verified' && dateComplete ? 'verified' : 'unverified'
            },
            updatedAt: typeof config.updatedAt === 'string' ? config.updatedAt : null
        };
        if (normalized && normalized.verification.status !== 'verified') warnings.push('欄位對應尚未核對：第一次開啟表單時請確認數字帶入正確的欄位');
        if (normalized && ver.reportedAt === 'verified' && Object.keys(raOut).length && !dateComplete) warnings.push('填報日期的欄位對應不完整（需要同一題的年、月、日、時、分），已改為手動填寫');
        if (normalized && normalized.verification.reportedAt !== 'verified') warnings.push('填報日期時間沒有自動帶入，請在表單手動填寫');
        return { valid: !errors.length, errors: errors, warnings: warnings, normalized: normalized };
    }

    function parsePrefillTemplate(url) {
        var form = normalizeFormUrl(url);
        if (form.error) return { formUrl: null, formId: null, entries: [], errors: [form.error] };
        var entries = [], seen = {};
        form.url.searchParams.forEach(function (value, name) {
            if (!validDateParam(name) || seen[name]) return;
            seen[name] = true;
            entries.push({ name: name, sample: String(value).slice(0, 80) });
        });
        return { formUrl: form.formUrl, formId: form.formId, entries: entries, errors: [] };
    }

    // 臺灣自 1979 年起沒有日光節約時間，固定 UTC+8；直接換算，不依賴瀏覽器 Intl 的 12／24 小時制設定
    function taipeiNow(date) {
        var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
        var t = new Date(d.getTime() + 8 * 3600000);
        var parts = { year: String(t.getUTCFullYear()), month: pad(t.getUTCMonth() + 1), day: pad(t.getUTCDate()),
                      hour: pad(t.getUTCHours()), minute: pad(t.getUTCMinutes()) };
        parts.text = parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute;
        return parts;
    }

    function teacherNameProblem(name, where) {
        var n = String(name == null ? '' : name).trim();
        if (!n || n === 'OOO 老師' || /^O+\s*老師$/.test(n) || /^O+$/.test(n)) return '導師姓名還是預設值，請先到' + where + '填寫真實導師姓名';
        return '';
    }

    function buildPrefillUrl(config, report, reportedAtTaipei, where) {
        where = where || '「⚙️ 班級設定」';
        var errors = [], omitted = ['照片（請在表單上傳）'];
        var v = validateConfig(config);
        if (!v.valid) return { url: null, blankUrl: null, omittedFields: omitted, errors: v.errors };
        var cfg = v.normalized;
        var info = report && isPlain(report.classInfo) ? report.classInfo : {};
        if (!report || (report.errors && report.errors.length)) errors.push('彙整資料有誤，請先修正紀錄');
        var className = String(info.className == null ? '' : info.className).trim();
        if (cfg.classOptions.indexOf(className) < 0) errors.push('班級「' + className + '」不在學校表單的選項裡，請先到' + where + '改成表單上的班級（例如 401）');
        var tp = teacherNameProblem(info.teacherName, where);
        if (tp) errors.push(tp);
        if (errors.length) return { url: null, blankUrl: cfg.formUrl, omittedFields: omitted, errors: errors };
        var u = new URL(cfg.formUrl);
        u.searchParams.set('usp', 'pp_url');
        u.searchParams.set(cfg.bindings.teacherName, String(info.teacherName).trim());
        u.searchParams.set(cfg.bindings.className, className);
        u.searchParams.set(cfg.bindings.studentTotal, String(report.studentTotal));
        u.searchParams.set(cfg.bindings.teacherTotal, String(report.teacherTotal));
        if (cfg.verification.reportedAt === 'verified' && reportedAtTaipei) {
            Object.keys(cfg.reportedAtBindings).forEach(function (param) {
                // 用不補零的數字（實測格式為 month=1、hour=0、minute=5）
                u.searchParams.set(param, String(Number(reportedAtTaipei[cfg.reportedAtBindings[param]])));
            });
        } else {
            omitted.unshift('填報日期時間（請在表單手動填寫）');
        }
        return { url: u.toString(), blankUrl: cfg.formUrl, omittedFields: omitted, errors: [] };
    }

    function buildReportText(report, classInfo, reportedAtTaipei) {
        var info = isPlain(classInfo) ? classInfo : {};
        var dates = (report.daily || []).map(function (x) { return x.ymd; }).filter(Boolean);
        return [
            'SH150 每週填報資料',
            '班級：' + (info.className || ''),
            '導師：' + (info.teacherName || ''),
            '學期：' + (info.semester || '') + '，第 ' + report.week + ' 週',
            '運動期間：' + (dates.length ? dates[0] + '～' + dates[dates.length - 1] : '（日期不明）'),
            '填報時間：' + (reportedAtTaipei ? reportedAtTaipei.text : '') + '（臺灣時間）',
            '學生當週運動總圈數：' + report.studentTotal,
            '  跑步：' + report.studentRunTotal + ' 圈；跳繩：' + report.studentJumpTotal + ' 下；每日換算合計：' + report.studentJumpLaps + ' 圈',
            '導師當週運動總圈數：' + report.teacherTotal + '（尚未乘 2）',
            '  跑步：' + report.teacherRunTotal + ' 圈；本次額外換算：' + report.teacherExtraLaps + ' 圈',
            '提醒：不含體育課。請補 1～2 張活動照片，再於學校表單提交。'
        ].join('\n');
    }

    // ── 介面樣式（自帶 sf- 前綴，不影響原頁面）──
    var CSS = [
        '.sf-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;z-index:2000;padding:12px;box-sizing:border-box}',
        '.sf-overlay.sf-show{display:flex}',
        '.sf-modal{background:#fff;border-radius:14px;width:100%;max-width:40rem;max-height:90vh;overflow-y:auto;padding:20px;box-sizing:border-box;font-size:15px;color:#334155;box-shadow:0 20px 40px rgba(0,0,0,.25)}',
        '.sf-modal h3{margin:0 0 4px;font-size:1.2rem;color:#1e293b}',
        '.sf-sub{color:#94a3b8;font-size:12px;margin:0 0 12px}',
        '.sf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:4px 16px;font-size:14px;margin-bottom:12px}',
        '.sf-grid b{color:#1e293b}',
        '.sf-tablewrap{overflow-x:auto;margin-bottom:12px}',
        '.sf-table{width:100%;border-collapse:collapse;font-size:14px}',
        '.sf-table th,.sf-table td{border:1px solid #e2e8f0;padding:4px 8px;text-align:center;white-space:nowrap}',
        '.sf-table th{background:#f8fafc;color:#64748b}',
        '.sf-totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:8px;margin-bottom:12px}',
        '.sf-total{border-radius:10px;padding:10px 12px;border:1px solid #bae6fd;background:#f0f9ff}',
        '.sf-total.sf-teacher{border-color:#a7f3d0;background:#ecfdf5}',
        '.sf-total small{display:block;color:#64748b;font-size:12px}',
        '.sf-total b{font-size:1.6rem;color:#0369a1}',
        '.sf-total.sf-teacher b{color:#047857}',
        '.sf-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px}',
        '.sf-row input[type=number]{width:5rem;padding:4px;border:1px solid #cbd5e1;border-radius:6px;text-align:center;font-size:15px}',
        '.sf-note{color:#94a3b8;font-size:12px;margin:0 0 10px}',
        '.sf-list{font-size:13px;color:#64748b;margin:0 0 10px;padding-left:20px}',
        '.sf-err,.sf-warn,.sf-ok{border-radius:8px;padding:8px 12px;font-size:14px;margin-bottom:8px}',
        '.sf-err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}',
        '.sf-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}',
        '.sf-ok{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46}',
        '.sf-err ul,.sf-warn ul{margin:4px 0 0;padding-left:20px}',
        '.sf-check{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin-bottom:8px}',
        '.sf-btns{display:flex;flex-wrap:wrap;gap:8px}',
        '.sf-btn{padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:14px;font-weight:600;cursor:pointer}',
        '.sf-btn:hover{background:#f8fafc}',
        '.sf-btn-primary{background:#2563eb;border-color:#2563eb;color:#fff}',
        '.sf-btn-primary:hover{background:#1d4ed8}',
        '.sf-btn-primary:disabled{opacity:.4;cursor:not-allowed}',
        '.sf-btn-soft{background:#e0f2fe;border-color:#bae6fd;color:#0369a1}',
        '.sf-btn-danger{background:#fef2f2;border-color:#fecaca;color:#b91c1c}',
        '.sf-push{margin-left:auto}',
        '.sf-hidden{display:none!important}',
        '.sf-msg{font-size:14px;margin:8px 0 0;min-height:1em}',
        '.sf-modal textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px}',
        '.sf-modal select{padding:4px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;margin-left:auto}',
        '.sf-modal code{font-size:12px;background:#f1f5f9;padding:1px 4px;border-radius:4px}',
        '.sf-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-top:10px}',
        '.sf-sec{border-top:1px solid #f1f5f9;padding-top:10px;margin-top:10px}',
        '.sf-break{word-break:break-all}',
        '@media print{.sf-overlay{display:none!important}}'
    ].join('\n');

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function button(text, cls) { var b = el('button', 'sf-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; return b; }
    function stable(v) {
        if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
        if (isPlain(v)) return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
        return JSON.stringify(v === undefined ? null : v);
    }
    function nonZero(o) {
        var out = {};
        Object.keys(o || {}).forEach(function (k) { var x = o[k]; if (isPlain(x) ? (Number(x.run) || Number(x.jump)) : Number(x)) out[k] = x; });
        return out;
    }

    // ── 啟動：adapter 由頁面提供 ──
    // adapter = { storageKey, snapshot(), classInfo(), storedWeek(week), settingsLabel, openClassSettings? }
    function init(adapter) {
        var A = adapter;
        var where = A.settingsLabel || '「⚙️ 班級設定」';
        var style = el('style'); style.textContent = CSS; document.head.appendChild(style);

        function readRaw() { try { return localStorage.getItem(A.storageKey); } catch (e) { return null; } }
        function loadConfig() {
            var raw = readRaw();
            if (raw === null) return { config: clone(DEFAULT_CONFIG), state: 'default' };
            var obj = null;
            try { obj = JSON.parse(raw); } catch (e) { obj = null; }
            var v = validateConfig(obj);
            if (v.valid) return { config: v.normalized, state: 'saved' };
            return { config: null, state: 'unsupported', errors: v.errors };   // 不覆蓋原字串
        }
        function saveConfig(cfg) {
            var v = validateConfig(cfg);
            if (!v.valid) { alert('設定沒有儲存：\n' + v.errors.join('\n')); return false; }
            v.normalized.updatedAt = new Date().toISOString();
            try { localStorage.setItem(A.storageKey, JSON.stringify(v.normalized)); }
            catch (e) { alert('設定沒有儲存：瀏覽器無法寫入（可能是儲存空間已滿）。原本的設定維持不變。'); return false; }
            return true;
        }

        // ── 建立兩個視窗 ──
        var rep = { overlay: el('div', 'sf-overlay'), modal: el('div', 'sf-modal') };
        rep.overlay.id = 'sf-report-modal';
        rep.modal.appendChild(el('h3', '', '📤 填報學校本週資料'));
        rep.modal.appendChild(el('p', 'sf-sub', '只送班級彙整（導師、班級、學生圈數、導師圈數、填報時間），不送學生姓名。'));
        rep.body = el('div'); rep.body.id = 'sf-report-body'; rep.modal.appendChild(rep.body);
        rep.checkRow = el('label', 'sf-check sf-hidden');
        rep.check = el('input'); rep.check.type = 'checkbox'; rep.check.id = 'sf-report-confirm';
        rep.checkRow.appendChild(rep.check); rep.checkRow.appendChild(el('span', '', '我已核對上面的數字與提醒'));
        rep.modal.appendChild(rep.checkRow);
        var btns = el('div', 'sf-btns');
        rep.open = button('🚀 開啟預填表單', 'sf-btn-primary'); rep.open.id = 'sf-report-open';
        rep.blank = button('開啟空白表單', 'sf-hidden'); rep.blank.id = 'sf-report-blank';
        rep.copy = button('📋 複製填報資料', 'sf-btn-soft'); rep.copy.id = 'sf-report-copy';
        rep.settings = button('⚙️ 學校表單設定'); rep.settings.id = 'sf-report-settings';
        rep.close = button('關閉', 'sf-push'); rep.close.id = 'sf-report-close';
        [rep.open, rep.blank, rep.copy, rep.settings, rep.close].forEach(function (b) { btns.appendChild(b); });
        rep.modal.appendChild(btns);
        rep.msg = el('p', 'sf-msg'); rep.msg.id = 'sf-report-msg'; rep.msg.setAttribute('aria-live', 'polite'); rep.modal.appendChild(rep.msg);
        rep.after = el('div', 'sf-ok sf-hidden'); rep.after.id = 'sf-report-after';
        rep.afterNote = el('p', '', ''); rep.afterNote.style.margin = '0';
        var again = el('p', '', ''); again.style.margin = '4px 0 0';
        again.appendChild(document.createTextNode('若沒有出現新分頁，'));
        rep.link = el('a', '', '點這裡再次開啟'); rep.link.id = 'sf-report-link'; rep.link.target = '_blank'; rep.link.rel = 'noopener noreferrer'; rep.link.href = '#';
        again.appendChild(rep.link); again.appendChild(document.createTextNode('。需要用學校帳號登入 Google。'));
        rep.verify = button('表單上四個欄位都帶入正確（記錄為已核對）', 'sf-btn-primary sf-hidden'); rep.verify.id = 'sf-report-verify'; rep.verify.style.marginTop = '6px';
        rep.after.appendChild(rep.afterNote); rep.after.appendChild(again); rep.after.appendChild(rep.verify);
        rep.modal.appendChild(rep.after);
        rep.copyBox = el('div', 'sf-hidden'); rep.copyBox.id = 'sf-report-copybox';
        rep.copyText = el('textarea'); rep.copyText.id = 'sf-report-copytext'; rep.copyText.readOnly = true; rep.copyText.rows = 8;
        rep.selectAll = button('全選'); rep.selectAll.style.marginTop = '4px';
        rep.copyBox.appendChild(rep.copyText); rep.copyBox.appendChild(rep.selectAll);
        rep.modal.appendChild(rep.copyBox);
        rep.overlay.appendChild(rep.modal);

        var set = { overlay: el('div', 'sf-overlay'), modal: el('div', 'sf-modal') };
        set.overlay.id = 'sf-form-modal';
        set.modal.appendChild(el('h3', '', '⚙️ 學校表單設定'));
        set.body = el('div'); set.body.id = 'sf-form-body'; set.body.style.marginTop = '10px'; set.modal.appendChild(set.body);
        set.msg = el('p', 'sf-msg'); set.msg.id = 'sf-form-msg'; set.modal.appendChild(set.msg);
        var sb = el('div', 'sf-btns sf-sec');
        set.exp = button('⬇️ 匯出填報設定'); set.exp.id = 'sf-form-export';
        var impLabel = el('label', 'sf-btn', '⬆️ 匯入填報設定');
        set.imp = el('input'); set.imp.type = 'file'; set.imp.accept = 'application/json,.json'; set.imp.id = 'sf-form-import'; set.imp.style.display = 'none';
        impLabel.appendChild(set.imp);
        set.reset = button('重設學校表單設定', 'sf-btn-danger'); set.reset.id = 'sf-form-reset';
        set.close = button('關閉', 'sf-push'); set.close.id = 'sf-form-close';
        [set.exp, impLabel, set.reset, set.close].forEach(function (b) { sb.appendChild(b); });
        set.modal.appendChild(sb);
        set.overlay.appendChild(set.modal);
        document.body.appendChild(rep.overlay);
        document.body.appendChild(set.overlay);

        // ── 預覽 ──
        var view = { snap: null, report: null, at: null, extra: 0, link: null };
        function takeSnapshot() { try { return A.snapshot(); } catch (e) { return null; } }
        function storedMatches(snap) {
            var wk = null;
            try { wk = A.storedWeek(snap.week); } catch (e) { wk = null; }
            var recA = wk && isPlain(wk.records) ? wk.records : {};
            var runA = wk && isPlain(wk.teacherRuns) ? wk.teacherRuns : {};
            return stable(nonZero(recA)) === stable(nonZero(snap.records)) && stable(nonZero(runA)) === stable(nonZero(snap.teacherRuns));
        }
        function bulletBox(cls, title, items) {
            var box = el('div', cls);
            if (title) box.appendChild(el('b', '', title));
            var ul = el('ul'); items.forEach(function (t) { ul.appendChild(el('li', '', t)); });
            box.appendChild(ul);
            return box;
        }

        function renderReport() {
            var box = rep.body;
            box.innerHTML = '';
            var snap = view.snap, info = A.classInfo();
            var st = loadConfig();
            var r = summarizeWeek(snap, snap.rosterCount, view.extra);
            r.classInfo = info;
            view.report = r;
            view.at = taipeiNow();
            view.cfgRaw = readRaw();

            var grid = el('div', 'sf-grid');
            [['班級', info.className], ['導師', info.teacherName], ['學期', info.semester + '，第 ' + r.week + ' 週'],
             ['運動期間', r.daily[0].ymd && r.daily[4].ymd ? r.daily[0].ymd + '～' + r.daily[4].ymd : '（日期不明）'],
             ['填報時間', view.at.text + '（臺灣時間）']].forEach(function (row) {
                var d = el('div'); d.appendChild(el('span', '', row[0] + '：')); d.appendChild(el('b', '', String(row[1])));
                grid.appendChild(d);
            });
            box.appendChild(grid);

            var wrap = el('div', 'sf-tablewrap'), table = el('table', 'sf-table'), tr = el('tr');
            ['日期', '學生跑步', '跳繩下數', '跳繩換算', '導師跑步'].forEach(function (h) { tr.appendChild(el('th', '', h)); });
            table.appendChild(tr);
            r.daily.forEach(function (x) {
                var row = el('tr');
                row.appendChild(el('td', '', '星期' + DAYS[x.day - 1] + (x.ymd ? ' ' + x.ymd.slice(5) : '')));
                [x.run + ' 圈', x.jump + ' 下', x.jumpLaps + ' 圈', x.teacherRun + ' 圈'].forEach(function (t) { row.appendChild(el('td', '', t)); });
                table.appendChild(row);
            });
            wrap.appendChild(table); box.appendChild(wrap);

            var totals = el('div', 'sf-totals');
            var a = el('div', 'sf-total'); a.appendChild(el('small', '', '學生填報圈數（跑步＋跳繩換算）')); a.appendChild(el('b', '', r.studentTotal + ' 圈'));
            var b = el('div', 'sf-total sf-teacher'); b.appendChild(el('small', '', '導師填報圈數（尚未乘 2）')); b.appendChild(el('b', '', r.teacherTotal + ' 圈'));
            totals.appendChild(a); totals.appendChild(b); box.appendChild(totals);

            var extraRow = el('label', 'sf-row');
            extraRow.appendChild(el('span', '', '導師額外換算圈數'));
            var inp = el('input'); inp.type = 'number'; inp.min = '0'; inp.step = '1'; inp.id = 'sf-report-extra'; inp.value = String(view.extra);
            inp.addEventListener('change', function () {
                var t = inp.value.trim();
                view.extra = t === '' ? 0 : (/^\d+$/.test(t) ? Number(t) : t);
                renderReport();
            });
            extraRow.appendChild(inp); box.appendChild(extraRow);
            box.appendChild(el('p', 'sf-note', '若導師另有跳繩，請填尚未乘 2 的換算圈數；沒有則填 0。' +
                (r.teacherExtraLaps ? '本次額外填報 ' + r.teacherExtraLaps + ' 圈，不含於原 SH150 列印總數。' : '')));

            var notes = el('ul', 'sf-list');
            ['跳繩依每天全班加總，每 200 下換算 1 圈；五天再相加。學校後台會把導師圈數乘 2。',
             '不含體育課；請確認登記資料符合學校規定。',
             '請在表單補上 1～2 張活動照片，並自行按提交。開啟表單不代表已繳交。',
             '學校表單沒有週次欄位：請確認上面的運動期間就是要填報的那一週。'].forEach(function (t) { notes.appendChild(el('li', '', t)); });
            box.appendChild(notes);

            var link = st.config ? buildPrefillUrl(st.config, r, view.at, where)
                : { url: null, blankUrl: null, errors: ['學校表單設定的格式無法辨識，請到「學校表單設定」重設'], omittedFields: [] };
            view.link = link;
            var warns = r.warnings.slice();
            if (!storedMatches(snap)) warns.push('本次依目前畫面資料計算；畫面上的紀錄和已存檔的不一樣，請先備份並確認紀錄已儲存');
            if (st.config) validateConfig(st.config).warnings.forEach(function (w) { warns.push(w); });
            var problems = r.errors.concat(link.errors || []);
            if (problems.length) box.appendChild(bulletBox('sf-err', '無法自動帶入表單：', problems));
            if (warns.length) box.appendChild(bulletBox('sf-warn', '', warns));

            var needCheck = warns.length > 0;
            rep.checkRow.classList.toggle('sf-hidden', !needCheck || !link.url);
            rep.check.checked = false;
            rep.open.disabled = !link.url || needCheck;
            rep.open.textContent = link.url ? '🚀 開啟預填表單' : '🚀 開啟預填表單（已停用）';
            rep.blank.classList.toggle('sf-hidden', !!link.url || !link.blankUrl);
            rep.after.classList.add('sf-hidden');
            rep.copyBox.classList.add('sf-hidden');
            rep.msg.textContent = '';
        }

        function refreshIfChanged() {
            var now = takeSnapshot();
            if (!now) { rep.msg.textContent = '資料還沒載入完成，請關閉後重新開啟。'; return false; }
            if (readRaw() !== view.cfgRaw) {
                // 預覽開著時學校表單設定被改了（例如另一個分頁）：不可沿用舊網址
                view.snap = now;
                renderReport();
                rep.msg.textContent = '⚠ 學校表單設定剛剛有變更，已重新整理，請重新核對後再按一次。';
                return false;
            }
            if (stable(now) === stable(view.snap)) return true;
            if (now.week !== view.snap.week) view.extra = 0;
            view.snap = now;
            renderReport();
            rep.msg.textContent = '⚠ 資料剛剛有變動，數字已更新，請重新核對後再按一次。';
            return false;
        }
        function showOpened(url, note) {
            rep.link.href = url;
            rep.afterNote.textContent = note;
            rep.after.classList.remove('sf-hidden');
            var st = loadConfig();
            rep.verify.classList.toggle('sf-hidden', !(st.config && st.config.verification.status !== 'verified' && view.link && url === view.link.url));
        }
        function openUrl(url) { try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {} }

        function openReport() {
            var snap = takeSnapshot();
            if (!snap) { alert('資料還沒載入完成，請稍等一下再按。'); return; }
            if (!view.snap || view.snap.week !== snap.week) view.extra = 0;
            view.snap = snap;
            renderReport();
            rep.overlay.classList.add('sf-show');
        }
        function closeReport() { rep.overlay.classList.remove('sf-show'); view.extra = 0; view.snap = null; view.link = null; }

        function copyReport() {
            if (!refreshIfChanged()) return;
            view.at = taipeiNow();
            var text = buildReportText(view.report, view.report.classInfo, view.at);
            function fallback() {
                rep.copyText.value = text; rep.copyBox.classList.remove('sf-hidden');
                rep.msg.textContent = '無法自動複製：請按「全選」後按 Ctrl+C 複製。';
            }
            try {
                if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
                navigator.clipboard.writeText(text).then(function () {
                    rep.copyBox.classList.add('sf-hidden');
                    rep.msg.textContent = '✅ 已複製填報資料。';
                }, fallback);
            } catch (e) { fallback(); }
        }

        // ── 設定 ──
        var draft = null;
        var ROLE_OPTIONS = [['', '不使用']].concat(CORE.map(function (k) { return [k, CORE_LABEL[k]]; }))
            .concat(DATE_PARTS.map(function (p) { return ['date:' + p, DATE_LABEL[p]]; }));
        function renderSettings() {
            var st = loadConfig(), box = set.body, cfg = st.config;
            box.innerHTML = '';
            if (st.state === 'unsupported') box.appendChild(el('div', 'sf-err', '目前存的學校表單設定格式無法辨識（可能來自較新版本或已損壞），預填已停用，原設定沒有被改動。可以用「複製填報資料」，或按「重設學校表單設定」。'));
            if (cfg) {
                var l1 = el('div', 'sf-break'); l1.appendChild(el('span', '', '學校表單：')); l1.appendChild(el('span', '', cfg.formUrl)); box.appendChild(l1);
                box.appendChild(el('div', '', '核對狀態：' + (cfg.verification.status === 'verified' ? '已核對（' + (cfg.verification.verifiedAt || '').slice(0, 10) + '）' : '尚未核對') +
                    '｜填報日期：' + (cfg.verification.reportedAt === 'verified' ? '自動帶入' : '手動填寫')));
                box.appendChild(el('div', '', '最後設定：' + (cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString('zh-TW') : '內建預設') + '｜第 ' + cfg.revision + ' 版'));
                var map = el('div', 'sf-note'); map.style.marginTop = '6px';
                CORE.forEach(function (k) { map.appendChild(el('div', '', CORE_LABEL[k] + ' → ' + cfg.bindings[k])); });
                Object.keys(cfg.reportedAtBindings).forEach(function (p) { map.appendChild(el('div', '', DATE_LABEL[cfg.reportedAtBindings[p]] + ' → ' + p)); });
                box.appendChild(map);
            }
            box.appendChild(el('p', 'sf-note', '「核對」只代表確認過欄位帶入位置，不代表學校已收到資料。照片與提交一律在 Google 表單完成，需用學校帳號登入。'));

            var sec = el('div', 'sf-sec');
            sec.appendChild(el('b', '', '更換學校表單'));
            sec.appendChild(el('p', 'sf-note', '貼上作答者網址，或承辦用「預先填寫表單」產生的連結（建議示範答案：學生 123456、導師 654321，方便辨認欄位）。'));
            var ta = el('textarea'); ta.rows = 3; ta.id = 'sf-form-paste'; sec.appendChild(ta);
            var parseBtn = button('解析連結', 'sf-btn-soft'); parseBtn.style.marginTop = '6px';
            parseBtn.addEventListener('click', function () {
                var res = parsePrefillTemplate(ta.value);
                if (res.errors.length) { set.msg.textContent = '⚠ ' + res.errors[0]; return; }
                var roles = {};
                if (cfg && res.formUrl === cfg.formUrl) {
                    CORE.forEach(function (k) { roles[cfg.bindings[k]] = k; });
                    Object.keys(cfg.reportedAtBindings).forEach(function (p) { roles[p] = 'date:' + cfg.reportedAtBindings[p]; });
                }
                var names = res.entries.map(function (e) { return e.name; });
                Object.keys(roles).forEach(function (n) { if (names.indexOf(n) < 0) res.entries.push({ name: n, sample: '（目前設定）' }); });
                draft = { formUrl: res.formUrl, entries: res.entries, roles: roles, sameForm: !!(cfg && res.formUrl === cfg.formUrl) };
                set.msg.textContent = '';
                renderDraft();
            });
            sec.appendChild(parseBtn);
            var holder = el('div'); holder.id = 'sf-form-draft'; sec.appendChild(holder);
            box.appendChild(sec);
            if (draft) renderDraft();

            var adv = el('details', 'sf-sec');
            adv.appendChild(el('summary', '', '進階：班級選項（須和表單下拉選單完全相同）'));
            var opt = el('textarea'); opt.rows = 4; opt.id = 'sf-form-classes'; opt.style.marginTop = '6px';
            opt.value = (cfg ? cfg.classOptions : CLASS_OPTIONS).join('\n');
            adv.appendChild(opt);
            var saveOpt = button('儲存班級選項', 'sf-btn-soft'); saveOpt.style.marginTop = '6px';
            saveOpt.addEventListener('click', function () {
                if (!cfg) return;
                var next = clone(cfg);
                next.classOptions = opt.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
                next.revision = cfg.revision + 1;
                next.verification = { status: 'unverified', verifiedAt: null, reportedAt: 'unverified' };
                if (saveConfig(next)) { set.msg.textContent = '✅ 已儲存班級選項（需重新核對）。'; renderSettings(); }
            });
            adv.appendChild(saveOpt);
            box.appendChild(adv);
        }
        function renderDraft() {
            var holder = document.getElementById('sf-form-draft');
            if (!holder || !draft) return;
            holder.innerHTML = '';
            var d = el('div', 'sf-box');
            d.appendChild(el('div', 'sf-note sf-break', (draft.sameForm ? '同一份表單：' : '新的表單：') + draft.formUrl));
            if (!draft.entries.length) {
                d.appendChild(el('p', 'sf-warn', '這個連結沒有欄位資訊。請改貼承辦產生的「預先填寫表單」連結，才能設定欄位對應。'));
            } else {
                d.appendChild(el('p', 'sf-note', '依右邊的示範答案，選擇每個欄位代表什麼（範例答案不會被保存）：'));
                draft.entries.forEach(function (e) {
                    var row = el('div', 'sf-row');
                    row.appendChild(el('code', '', e.name));
                    row.appendChild(el('span', 'sf-note', '示範：' + (e.sample || '（空白）')));
                    var sel = el('select');
                    ROLE_OPTIONS.forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; sel.appendChild(op); });
                    sel.value = draft.roles[e.name] || '';
                    sel.addEventListener('change', function () { draft.roles[e.name] = sel.value; });
                    row.appendChild(sel);
                    d.appendChild(row);
                });
            }
            var dateOk = el('label', 'sf-row sf-note');
            var dchk = el('input'); dchk.type = 'checkbox'; dchk.id = 'sf-form-date-verified';
            dateOk.appendChild(dchk);
            dateOk.appendChild(el('span', '', '日期欄位已用官方預填範本實測（午夜、下午、跨年都正確）才勾選；沒勾選時日期一律手動填寫'));
            d.appendChild(dateOk);
            var row2 = el('div', 'sf-btns');
            var save = button('儲存新設定', 'sf-btn-primary'), cancel = button('取消');
            save.addEventListener('click', function () {
                var st = loadConfig(), base = st.config || clone(DEFAULT_CONFIG), bindings = {}, ra = {};
                Object.keys(draft.roles).forEach(function (name) {
                    var role = draft.roles[name];
                    if (!role) return;
                    if (role.indexOf('date:') === 0) ra[name] = role.slice(5); else bindings[role] = name;
                });
                var next = { schema: 1, revision: (st.config ? st.config.revision : 0) + 1, formUrl: draft.formUrl,
                    bindings: bindings, reportedAtBindings: ra, classOptions: base.classOptions,
                    verification: { status: 'unverified', verifiedAt: null, reportedAt: dchk.checked && Object.keys(ra).length ? 'verified' : 'unverified' },
                    updatedAt: null };
                if (saveConfig(next)) { draft = null; set.msg.textContent = '✅ 已儲存新的學校表單設定（第一次開啟時請核對）。'; renderSettings(); }
            });
            cancel.addEventListener('click', function () { draft = null; holder.innerHTML = ''; set.msg.textContent = '已取消，設定沒有變動。'; });
            row2.appendChild(save); row2.appendChild(cancel);
            d.appendChild(row2);
            holder.appendChild(d);
        }
        function exportConfig() {
            var st = loadConfig();
            if (!st.config) { alert('目前的設定無法辨識，不能匯出。'); return; }
            var c = clone(st.config);
            c.verification = { status: 'unverified', verifiedAt: null, reportedAt: c.verification.reportedAt };
            var file = { app: 'classroom-timer-school-form', schema: 1, exportedAt: new Date().toISOString(), config: c };
            var blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob), a = document.createElement('a'), now = new Date();
            a.href = url; a.download = '學校表單設定_' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        }
        function importConfig(file) {
            if (file.size > MAX_CONFIG) { alert('匯入失敗：檔案太大。'); return; }
            var reader = new FileReader();
            reader.onload = function (e) {
                var obj = null;
                try { obj = JSON.parse(e.target.result); } catch (err) { obj = null; }
                if (!obj || obj.app !== 'classroom-timer-school-form' || obj.schema !== 1 || !isPlain(obj.config)) {
                    alert('匯入失敗：這不是「學校表單設定」檔。（SH150 紀錄備份請用「📥 載入」）'); return;
                }
                var cfg = clone(obj.config), st = loadConfig();
                cfg.verification = { status: 'unverified', verifiedAt: null, reportedAt: isPlain(cfg.verification) && cfg.verification.reportedAt === 'verified' ? 'verified' : 'unverified' };
                cfg.revision = (st.config ? st.config.revision : 0) + 1;
                var v = validateConfig(cfg);
                if (!v.valid) { alert('匯入失敗：\n' + v.errors.join('\n')); return; }
                if (saveConfig(cfg)) { set.msg.textContent = '✅ 已匯入學校表單設定（請重新核對）。'; renderSettings(); }
            };
            reader.readAsText(file);
        }
        function openSettings() { draft = null; renderSettings(); set.msg.textContent = ''; set.overlay.classList.add('sf-show'); }

        // ── 事件（只綁一次）──
        rep.close.addEventListener('click', closeReport);
        rep.overlay.addEventListener('click', function (e) { if (e.target === rep.overlay) closeReport(); });
        rep.check.addEventListener('change', function () { rep.open.disabled = !view.link || !view.link.url || !rep.check.checked; });
        rep.open.addEventListener('click', function () {
            if (!refreshIfChanged() || !view.link || !view.link.url) return;
            view.at = taipeiNow();
            var st = loadConfig();
            var link = st.config ? buildPrefillUrl(st.config, view.report, view.at, where) : null;
            if (!link || !link.url) { renderReport(); return; }
            view.link = link;
            view.openedCfgRaw = view.cfgRaw;
            openUrl(link.url);
            showOpened(link.url, '已產生預填連結（填報時間 ' + view.at.text + '）。請在學校表單核對數字、補上 1～2 張照片，再自己按「提交」。');
        });
        rep.blank.addEventListener('click', function () {
            if (!view.link || !view.link.blankUrl) return;
            openUrl(view.link.blankUrl);
            showOpened(view.link.blankUrl, '已開啟空白表單。請按「複製填報資料」對照填寫，補照片後自己按「提交」。');
        });
        rep.copy.addEventListener('click', copyReport);
        rep.selectAll.addEventListener('click', function () { rep.copyText.focus(); rep.copyText.select(); });
        rep.settings.addEventListener('click', openSettings);
        rep.verify.addEventListener('click', function () {
            var st = loadConfig();
            if (!st.config) return;
            if (readRaw() !== view.openedCfgRaw) {
                rep.msg.textContent = '⚠ 學校表單設定在開啟後有變更，請重新開啟表單後再核對。';
                rep.verify.classList.add('sf-hidden');
                return;
            }
            if (!confirm('確認剛剛開啟的學校表單中，導師、班級、學生圈數、導師圈數都帶入正確的欄位嗎？')) return;
            var next = clone(st.config);
            next.verification.status = 'verified';
            next.verification.verifiedAt = new Date().toISOString();
            if (saveConfig(next)) { rep.verify.classList.add('sf-hidden'); rep.msg.textContent = '✅ 已記錄：核對過欄位對應。'; }
        });
        set.close.addEventListener('click', function () { draft = null; set.overlay.classList.remove('sf-show'); if (view.snap) renderReport(); });
        set.overlay.addEventListener('click', function (e) { if (e.target === set.overlay) set.close.click(); });
        set.exp.addEventListener('click', exportConfig);
        set.imp.addEventListener('change', function (e) { if (e.target.files[0]) importConfig(e.target.files[0]); e.target.value = ''; });
        set.reset.addEventListener('click', function () {
            if (!confirm('要把學校表單設定重設回內建值嗎？\n（只重設這個功能的設定，不會動到任何運動紀錄或班級資料）')) return;
            try { localStorage.removeItem(A.storageKey); } catch (e) {}
            if (readRaw() !== null) { set.msg.textContent = '⚠ 重設失敗：瀏覽器無法刪除設定，原本的設定維持不變。'; return; }
            draft = null; set.msg.textContent = '✅ 已重設為內建設定。'; renderSettings();
        });

        return { open: openReport, openSettings: openSettings };
    }

    window.SH150SchoolForm = {
        init: init, summarizeWeek: summarizeWeek, validateConfig: validateConfig, parsePrefillTemplate: parsePrefillTemplate,
        buildPrefillUrl: buildPrefillUrl, buildReportText: buildReportText, normalizeFormUrl: normalizeFormUrl,
        taipeiNow: taipeiNow, defaultConfig: function () { return clone(DEFAULT_CONFIG); }
    };
})();
