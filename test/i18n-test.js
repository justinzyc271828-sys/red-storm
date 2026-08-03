/* i18n 双语测试:t()/tf() 行为、语言切换持久化、Node 默认 zh、
 * STRINGS_EN 覆盖率——静态扫描全部 src 的 t/tStr/tf 字面量 key,
 * 动态遍历 units/config/field-guide 数据串,含汉字则必须在表。
 * 运行:node test/i18n-test.js */
'use strict';
require('../src/config.js'); // 兜底带上 RS.i18n
require('../src/units.js'); require('../src/field-guide.js');
const RS = globalThis.RS;
const fs = require('fs'), path = require('path');
let failures = 0;
const check = (name, ok, info) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (info !== undefined ? '  (' + info + ')' : '')); if (!ok) failures++; };

const i18n = RS.i18n, EN = i18n._strings;
const HAN = /[一-鿿]/;

// —— 基础行为(Node 默认 zh)——
check('Node 环境默认 zh', i18n.getLang() === 'zh');
check('zh 模式 t() 原样返回', i18n.t('步兵') === '步兵');

// —— 英文模式查表与漏翻回退 ——
check('setLang(en) 生效', i18n.setLang('en') === true && i18n.getLang() === 'en');
check('en 模式 t() 返回英文', i18n.t('步兵') === 'Rifleman', i18n.t('步兵'));
check('en 模式漏翻回退中文', i18n.t('一句肯定没翻过的中文') === '一句肯定没翻过的中文');
check('tf 占位替换 + 英文语序',
  i18n.tf('第{n}章 · {title}', { n: 3, title: i18n.t('最后指令') }) === 'Chapter 3 · Final Directive',
  i18n.tf('第{n}章 · {title}', { n: 3, title: i18n.t('最后指令') }));

// —— 切换持久化与监听 ——
const written = [];
globalThis.localStorage = {
  getItem: () => null,
  setItem: (k, v) => written.push([k, v]),
};
let notified = null;
i18n.onChange(l => { notified = l; });
i18n.setLang('zh');
check('onChange 回调触发', notified === 'zh');
check('setLang 写 localStorage', written.some(([k, v]) => k === 'red-storm-lang' && v === 'zh'));
check('重复 setLang 同值返回 false', i18n.setLang('zh') === false);
check('非法语言返回 false', i18n.setLang('fr') === false && i18n.getLang() === 'zh');
delete globalThis.localStorage;

// —— 静态扫描:src/*.js 中 t/tStr/tf/tfStr('字面量') 的 key 必须已翻译 ——
const SRC = path.join(__dirname, '..', 'src');
const CALL_RE = /\b(?:t|tf|tStr|tfStr)\(\s*'((?:[^'\\]|\\.)*)'/g;
const literalKeys = new Set();
for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'i18n.js')) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  let m;
  while ((m = CALL_RE.exec(src))) {
    const key = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (HAN.test(key)) literalKeys.add(key);
  }
}
const missingLiteral = [...literalKeys].filter(k => !(k in EN));
check('静态扫描字面量 key 全部在表(' + literalKeys.size + ' 条)', missingLiteral.length === 0,
  missingLiteral.slice(0, 5).join(' | ') || undefined);

// —— 动态扫描:units/config/field-guide 数据串含汉字必须在表 ——
const dataStrings = new Set();
const collect = v => {
  if (typeof v === 'string') { if (HAN.test(v)) dataStrings.add(v); }
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
};
Object.values(RS.units.TYPES).forEach(def => collect([def.name, def.role]));
Object.values(RS.config.buildings).forEach(def => collect(def.name));
collect(RS.fieldGuide);
const missingData = [...dataStrings].filter(k => !(k in EN));
check('动态数据串全部在表(' + dataStrings.size + ' 条)', missingData.length === 0,
  missingData.slice(0, 5).join(' | ') || undefined);

// —— tf 模板 key 的英文译文必须保留全部占位符种类(次数允许压缩,如 '第{n}章 // CHAPTER {n}' → 'CHAPTER {n}') ——
const badPlaceholder = [...literalKeys].filter(k => /\{\w+\}/.test(k)).filter(k => {
  const en = EN[k];
  if (typeof en !== 'string') return true;
  const uniq = s => [...new Set(s.match(/\{(\w+)\}/g) || [])].sort().join();
  return uniq(k) !== uniq(en);
});
check('tf 模板占位符两侧一致', badPlaceholder.length === 0, badPlaceholder.slice(0, 3).join(' | ') || undefined);

console.log(failures ? ('FAIL ' + failures) : 'ALL PASS');
process.exit(failures ? 1 : 0);
