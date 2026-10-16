const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// A minimal DOM double executes the real inline script without dependencies.
// This verifies rendering logic, not browser layout or CSS.
function loadPage(search = '') {
  const nodes = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.id = '';
      this.className = '';
      this.style = {};
      this.attributes = {};
      this.children = [];
      this.value = '';
      this.textContent = '';
      this._html = '';
      this.classList = {
        contains: cls => this.className.split(/\s+/).includes(cls),
        add: cls => { if (!this.classList.contains(cls)) this.className += ' ' + cls; },
        toggle: cls => {
          if (this.classList.contains(cls)) this.className = this.className.split(/\s+/).filter(c => c !== cls).join(' ');
          else this.classList.add(cls);
        }
      };
      nodes.push(this);
    }
    set innerHTML(value) { this._html = value; this.children = []; }
    get innerHTML() { return this._html; }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) { return walk(this).find(el => matches(el, selector)) || null; }
  }
  const walk = el => el.children.flatMap(child => [child, ...walk(child)]);
  const matches = (el, selector) => selector.split('.').filter(Boolean).every(cls => el.classList.contains(cls));
  const roots = new Map();
  for (const id of html.matchAll(/\bid="([^"]+)"/g)) {
    const node = new Element();
    node.id = id[1];
    roots.set(id[1], node);
  }
  roots.get('semE').className = 'sem-card';
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => roots.get(id) || [...roots.values()].flatMap(walk).find(el => el.id === id) || null,
    querySelectorAll: selector => [...roots.values()].flatMap(el => [el, ...walk(el)]).filter(el => matches(el, selector))
  };
  const context = vm.createContext({ document, window: { location: { search } }, URLSearchParams,
    Uint8Array, TextDecoder, atob, console: { error() {} } });
  vm.runInContext(script, context);
  return {
    document,
    evaluate: expression => vm.runInContext(expression, context),
    data: expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context))),
    apply: data => { document.getElementById('jsonInput').value = typeof data === 'string' ? data : JSON.stringify(data); return vm.runInContext('applyJsonStatus()', context); }
  };
}

const expectedCodes = [
  ['0212ثقف-2', '0291تطوع-2', '0383ريض-3', '0522نجل-5', '1311عال-3'],
  ['0221عرب-2', '0292نجل-2', '0381ريض-3', '0384ريض-3', '1312عال-3', '2261نال-2'],
  ['1231نال-2', '1300أمن-3', '2323عال-3', '2412أمن-4', '2413عال-4', '3226عال-2'],
  ['2321نال-3', '2340أمن-3', '2361أمن-3', '2431عال-4', '2461عال-4', '3315عال-4'],
  ['3331أمن-3', '3332أمن-3', '3351أمن-3', '3371أمن-3', '3372أمن-3', '4342هال-3'],
  ['3333أمن-3', '3334أمن-3', '3373أمن-3', '3373نال-3', '3381أمن-4'],
  ['0401مهر-4', '3358نال-3', '4335أمن-3', '4336أمن-3', '4342أمن-3', '4391أمن-3'],
  ['4892أمن-8']
];

test('CYS metadata replaces CS specialty and old totals', () => {
  assert.match(html, /<title>خطة الأمن السيبراني/);
  for (const value of ['010107', '0101072', 'مجال التحقيق الجنائي الرقمي', 'الإصدار: 1', 'نوع الخطة: فرعي']) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /010201|4882عال|4381عال|الخطة الدراسية – علوم الحاسب|>140</);
});

test('all eight semesters match supplied CYS course codes and hours', () => {
  const page = loadPage();
  const semesters = page.data('semestersData');
  assert.deepEqual(semesters.map(sem => sem.courses.map(c => c.code)), expectedCodes);
  assert.deepEqual(semesters.map(s => s.total), [15, 15, 18, 21, 18, 16, 19, 8]);
  assert.equal(semesters.flatMap(s => s.courses).length, 41);
  for (const semester of semesters) assert.equal(semester.total, semester.courses.reduce((n, c) => n + c.credit, 0));
  assert.equal(page.evaluate('semestersData.reduce((n,s) => n+s.total,0)'), 130);
  assert.equal(page.document.getElementById('planTotal').textContent, 134);
  assert.match(page.document.getElementById('statsBar').innerHTML, />41<.*مقرر إجباري/);
  assert.match(page.document.getElementById('statsBar').innerHTML, />130<.*ساعات إجبارية/);
  assert.match(page.document.getElementById('hoursSummary').innerHTML, /الإجمالي: 134/);
});

test('elective catalog is 20 hours but required elective plus free load is only four', () => {
  const page = loadPage();
  assert.equal(page.evaluate('electivesList.length'), 10);
  assert.equal(page.evaluate('electivesList.reduce((sum,c) => sum+c.credit,0)'), 20);
  assert.equal(page.evaluate('electiveRequiredHours + freeHours'), 4);
  assert.equal(page.evaluate('allCourses.length'), 51);
  assert.equal(page.evaluate('new Set(allCourses.map(c=>c.code)).size'), 51);
});

test('all 18 prerequisite relationships match the document, not the old CS plan', () => {
  const page = loadPage();
  const expected = {
    '0292نجل-2': '0522نجل-5', '1312عال-3': '1311عال-3',
    '2412أمن-4': '0383ريض-3', '2413عال-4': '1312عال-3',
    '2340أمن-3': '2412أمن-4', '2361أمن-3': '1231نال-2',
    '2431عال-4': '2413عال-4', '2461عال-4': '2413عال-4',
    '3331أمن-3': '2340أمن-3', '3371أمن-3': '2413عال-4',
    '3372أمن-3': '3315عال-4', '3333أمن-3': '4342هال-3',
    '3334أمن-3': '2323عال-3', '3373أمن-3': '2340أمن-3',
    '3381أمن-4': '2323عال-3', '4335أمن-3': '3372أمن-3',
    '4336أمن-3': '3351أمن-3', '4342أمن-3': '3373نال-3'
  };
  const courses = page.data('semestersData.flatMap(s=>s.courses)');
  for (const course of courses) assert.equal(course.prereq?.split(' – ')[0] ?? null, expected[course.code] ?? null, course.code);
});

test('initial rendering creates eight tables with all courses NOT_TAKEN', () => {
  const page = loadPage();
  assert.equal(page.document.getElementById('dynamic-semesters').children.length, 8);
  for (let n = 1; n <= 8; n++) assert.match(page.document.getElementById(`sem${n}-body`).innerHTML, /<table>/);
  assert.ok(page.data('Object.values(currentStatusMap)').every(status => status === 'NOT_TAKEN'));
  assert.match(page.document.getElementById('electives-container').innerHTML, /الأخلاق والقيم/);
});

test('nested levels, flat code and legacy courseCode formats work', () => {
  const page = loadPage();
  assert.equal(page.apply([{ courses: [{ code: '2412أمن-4', status: 'TAKEN' }, { code: '3332أمن-3', status: 'TAKEN_NOW' }] }]), true);
  assert.equal(page.evaluate("currentStatusMap['2412أمن-4']"), 'TAKEN');
  assert.match(page.document.getElementById('sem3-body').innerHTML, /status-taken/);
  assert.match(page.document.getElementById('sem5-body').innerHTML, /status-now/);
  assert.equal(page.apply([{ courseCode: '1300أمن-3', status: 'TAKEN_NOW' }, { code: '0211ثقف-2', status: 'TAKEN' }]), true);
  assert.equal(page.evaluate("currentStatusMap['1300أمن-3']"), 'TAKEN_NOW');
  assert.equal(page.evaluate("currentStatusMap['2412أمن-4']"), 'NOT_TAKEN');
  assert.match(page.document.getElementById('electives-container').innerHTML, /status-taken/);
});

test('bad JSON, wrong schema and invalid statuses preserve previous state', () => {
  const page = loadPage();
  page.apply([{ code: '2412أمن-4', status: 'TAKEN' }]);
  const previous = page.data('currentStatusMap');
  for (const invalid of ['{', '{}', 'null', '[]', '[null]', '[{"code":"2412أمن-4","status":"invalid"}]', '[{"code":"4882عال-8","status":"TAKEN"}]']) {
    assert.equal(page.apply(invalid), false);
    assert.deepEqual(page.data('currentStatusMap'), previous);
    assert.match(page.document.getElementById('jsonFeedback').textContent, /تعذر تطبيق/);
  }
});

test('unknown codes and malicious fields never replace plan or enter rendered HTML', () => {
  const page = loadPage();
  assert.equal(page.apply([null, { code: '4882عال-8', status: 'TAKEN' }, { code: '1300أمن-3', status: 'TAKEN', name: '<img src=x onerror=alert(1)>' }]), true);
  assert.match(page.document.getElementById('jsonFeedback').textContent, /تم تجاهل 2/);
  assert.doesNotMatch(page.document.getElementById('sem3-body').innerHTML, /onerror/);
  assert.equal(page.evaluate('allCourses.length'), 51);
});

test('reset clears imported status and JSON', () => {
  const page = loadPage();
  page.apply([{ code: '2412أمن-4', status: 'TAKEN' }]);
  page.evaluate('resetToDefault()');
  assert.ok(page.data('Object.values(currentStatusMap)').every(status => status === 'NOT_TAKEN'));
  assert.equal(page.document.getElementById('jsonInput').value, '');
});

test('semester collapse and keyboard controls survive status render', () => {
  const page = loadPage();
  const header = page.document.getElementById('sem3').querySelector('.sem-header');
  let prevented = false;
  header.onkeydown({ key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(header.attributes['aria-expanded'], 'false');
  page.apply([{ code: '2412أمن-4', status: 'TAKEN' }]);
  assert.equal(page.document.getElementById('sem3').classList.contains('collapsed'), true);
});

test('UTF-8 JsonC link imports nested levels and rejects corrupt encoding safely', () => {
  const data = [{ level: 'الثالث', courses: [{ code: '2412أمن-4', status: 'TAKEN' }] }];
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const page = loadPage('?JsonC=' + encodeURIComponent(encoded));
  assert.equal(page.evaluate("currentStatusMap['2412أمن-4']"), 'TAKEN');
  assert.equal(page.document.getElementById('panelContent').style.display, 'block');
  const invalid = loadPage('?JsonC=%%%');
  assert.match(invalid.document.getElementById('jsonFeedback').textContent, /Base64/);
});
