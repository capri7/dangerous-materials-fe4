// /js/review.js
import { supabase } from '/js/supabaseClient.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const escapeHtml = (s = '') =>
  s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// 3分野の表示順（固定）
const CATEGORY_ORDER = ['危険物に関する法令', '物理と化学', '性質と火災予防'];

const CAT_SHORT = {
  '危険物に関する法令': '法令',
  '物理と化学': '物理と化学',
  '性質と火災予防': '性質と火災予防'
};


// 小分類の日本語マップ（必要に応じて拡張）
const SUBCAT_JA = {
  // 法令
  legal_framework: '消防法の法体系',
  defined_substances: '消防法で規定する危険物',
  class4_substances: '第4類危険物',
  designated_quantities: '危険物の指定数量',
  facility_categories: '製造所・貯蔵所・取扱所の区分',
  facility_permissions: '製造所等の設置と変更の許可',
  notification_of_changes: '変更の届出',
  temporary_storage_handling: '仮貯蔵と仮取扱い',
  handler_certification: '危険物取扱者の制度',
  license_issuance: '免状の交付・書換え・再交付',
  safety_lectures: '保安講習',
  safety_supervisors: '危険物保安監督者',
  chief_safety_officers: '危険物保安統括管理者',
  facility_safety_staff: '危険物施設保安員',
  preventive_regulations: '予防規程',
  preventive_regulation_items: '予防規程に定めるべき事項',
  facility_maintenance_management: '危険物施設の維持・管理',
  regular_inspections: '定期点検',
  safety_inspections: '保安検査',
  safety_distance: '保安距離',
  buffer_space_requirements: '保有空地',
  manufacturing_facility_standards: '製造所の基準',
  indoor_storage_standards: '屋内貯蔵所の基準',
  outdoor_tank_storage_standards: '屋外タンク貯蔵所の基準',
  indoor_tank_storage_standards: '屋内タンク貯蔵所の基準',
  underground_tank_storage_standards: '地下タンク貯蔵所の基準',
  simple_tank_storage_standards: '簡易タンク貯蔵所の基準',
  mobile_tank_storage_standards: '移動タンク貯蔵所（タンクローリー等）の基準',
  outdoor_storage_standards: '屋外貯蔵所の基準',
  refueling_station_standards: '給油取扱所の基準',
  self_refueling_station_standards: 'セルフ型の給油取扱所の基準',
  sales_station_standards: '販売取扱所の基準',
  signs_and_notices: '標識・掲示板',
  general_standards_part1: '共通の基準【1】',
  general_standards_part2: '共通の基準【2】',
  transportation_standards: '運搬の基準',
  firefighting_equipment_standards: '消火設備と設置基準',
  alarm_systems: '警報設備',
  administrative_orders_and_suspensions: '措置命令・許可の取消・使用停止命令',
  emergency_measures: '事故発生時の応急措置',
  chapter1_summary: '第1章のまとめ',
  // 物理と化学
  combustion_chemistry: '燃焼の化学',
  types_of_combustion: '燃焼の区分',
  ease_of_combustion: '燃焼の難易',
  ignition_and_flash_point: '引火と発火',
  flammability_range: '燃焼範囲',
  spontaneous_combustion: '自然発火',
  dust_explosions: '粉じん爆発',
  extinguishing_agents: '消火と消火剤',
  electricity_and_batteries: '電気の計算 / 電池',
  static_electricity: '静電気',
  electrolysis: '電気分解',
  states_of_matter: '物質の三態',
  boiling_point_vapor_pressure: '沸点と飽和蒸気圧',
  specific_gravity_vapor_density: '比重と蒸気比重',
  gas_laws: 'ボイルの法則/シャルルの法則/ドルドンの法則',
  heat_and_specific_heat: '熱量と比熱',
  heat_transfer: '熱の移動',
  thermal_expansion: '熱膨張',
  physical_and_chemical_changes: '物理変化と化学変化',
  elements_compounds_mixtures: '単体・化合物・混合物',
  basics_of_chemistry: '科学の基礎',
  reaction_rate_and_equilibrium: '反応速度と化学平衡',
  acids_and_bases: '酸と塩基（アルカリ）',
  oxidation_and_reduction: '酸化と還元',
  mixing_hazards: '混合危険',
  classification_of_elements: '元素の分類',
  electrochemical_series: 'イオン化傾向',
  metal_corrosion: '金属の腐食',
  organic_compounds: '有機化合物',
  polymer_materials: '高分子材料',
  properties_of_major_gases: '主な気体の特性',
  // 性質と火災予防
  classification_of_dangerous_goods: '危険物の分類',
  class4_properties: '第4類危険物の性状',
  class4_extinguishing_methods: '第4類危険物の消火',
  class4_storage_handling: '第4類危険物の貯蔵・取扱い',
  accident_cases_and_measures: '事故事例と対策',
  special_flammable_properties: '特殊引火物の性状',
  class1_petroleum_properties: '第1石油類の性状',
  alcohol_properties: 'アルコール類の性状',
  class2_petroleum_properties: '第2石油類の性状',
  class3_petroleum_properties: '第3石油類の性状',
  class4_petroleum_properties: '第4石油類の性状',
  animal_vegetable_oil_properties: '動植物油類の性状'
};

function qNoFromId(id = '') {
  const m = id.match(/_(\d{3,})$/);
  return m ? String(parseInt(m[1], 10)) : '';
}

// 表示用タイトルを組み立て
function buildDisplayTitle(item) {
  const qn  = qNoFromId(item.question_id) || '?';
  const cat = (CAT_SHORT?.[item.category] || item.category || '');
  const sub = toJaSubcat(item.subcategory || '');
  const hasStar = /⭐/.test(item.title || '');   // ← 元タイトルに⭐が含まれるか判定
  return `【問${qn}】${cat}：${sub}${hasStar ? '　【⭐️】' : ''}`;
}


const norm = (s='') => s.toLowerCase().trim().replace(/[\s-]+/g, '_');
const toJaSubcat = (s='') => {
  const key = norm(s);
  return SUBCAT_JA[key] || (s ? s.replace(/_/g, ' ') : '');
};

const here = () => location.pathname + location.search + location.hash;

async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const next = encodeURIComponent(here());
    window.location.href = `/login.html?next=${next}`;
    return null;
  }
  return session.user;
}

const fmtDate = (iso) => { try { return iso ? new Date(iso).toLocaleDateString('ja-JP') : ''; } catch { return ''; } };

function renderCard(item) {
  const el = document.createElement('div');
  el.className = 'card review-card';
  el.dataset.id = item.id;

  const meta = item.last_reviewed_at
    ? `最終確認: ${fmtDate(item.last_reviewed_at)}`
    : `追加: ${fmtDate(item.created_at)}`;

  el.innerHTML = `
    <div class="card__body">
      <h3 class="card__title">${escapeHtml(buildDisplayTitle(item))}</h3>
      <p class="card__meta">${meta}</p>
      <div class="card__actions">
        <a class="btn btn--primary action-open" href="${item.content_path}">▶ 確認する</a>
        <button class="btn btn--danger action-remove">復習済みにする</button>
      </div>
    </div>
  `;
  return el;

}

function groupByCategoryAndSub(data) {
  const groups = {}; // { [cat]: { [sub]: Item[] } }
  for (const it of data) {
    const cat = it.category || '未分類';
    const subName = toJaSubcat(it.subcategory || '');
    if (!groups[cat]) groups[cat] = {};
    if (!groups[cat][subName]) groups[cat][subName] = [];
    groups[cat][subName].push(it);
  }
  return groups;
}

function renderGroups(groups) {
  const root = $('#review-list');
  root.innerHTML = '';

  const cats = [
    ...CATEGORY_ORDER.filter(c => groups[c]),
    ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c))
  ];

  let total = 0;

  for (const cat of cats) {
    const sec = document.createElement('section');
    sec.className = 'review-cat';
    sec.innerHTML = `<h2 class="review-cat__title">${escapeHtml(cat)}</h2>`;
    const subs = groups[cat];

    for (const [sub, items] of Object.entries(subs)) {
      total += items.length;
      const wrapper = document.createElement('div');
      wrapper.className = 'review-sub';
      const subTitle = sub ? `<h3 class="review-sub__title">${escapeHtml(sub)}</h3>` : '';
      wrapper.innerHTML = `${subTitle}<div class="card-list"></div>`;
      const list = wrapper.querySelector('.card-list');
      items.forEach(it => list.appendChild(renderCard(it)));
      sec.appendChild(wrapper);
    }
    root.appendChild(sec);
  }

  const cnt1 = document.querySelector('#review-count');
  if (cnt1) cnt1.textContent = `${total}件`;
}

async function loadList() {
  const user = await ensureAuth();
  if (!user) return;

  const emptyEl = $('#empty-msg');
  emptyEl.style.display = 'none';

  const { data, error } = await supabase
    .from('user_review_items')
    .select('id, question_id, title, category, subcategory, content_path, created_at, last_reviewed_at, status')
    .eq('status', 'active')
    .order('last_reviewed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[review] load error', error);
    emptyEl.textContent = '読み込みに失敗しました。しばらくしてから再度お試しください。';
    emptyEl.style.display = 'block';
    return;
  }

  if (!data || data.length === 0) {
    document.querySelector('#review-list').innerHTML = '';
    const cnt2 = document.querySelector('#review-count');
    if (cnt2) cnt2.textContent = '0件';
    emptyEl.style.display = 'block';
    return;
  }

  const grouped = groupByCategoryAndSub(data);
  renderGroups(grouped);
}

// 削除（＝ status を mastered にする）
async function removeItem(rowId, btn) {
  btn.disabled = true;
  btn.textContent = '処理中…';
  const { error } = await supabase
    .from('user_review_items')
    .update({ status: 'mastered', last_reviewed_at: new Date().toISOString() })
    .eq('id', rowId);

  if (error) {
    console.error('[review] remove error', error);
    btn.disabled = false;
    btn.textContent = '復習済みにする';
    alert('削除に失敗しました。通信状況をご確認ください。');
    return;
  }

  const card = btn.closest('.review-card');
  if (card) {
    const parentSub  = card.closest('.review-sub');   // 小見出しのラッパ
    const catSection = card.closest('.review-cat');   // カテゴリのラッパ
    card.remove();

    // 小見出しが空なら小見出しごと削除
    if (parentSub && parentSub.querySelectorAll('.review-card').length === 0) {
      parentSub.remove();
    }
    // カテゴリ節が空なら節ごと削除
    if (catSection && catSection.querySelectorAll('.review-card').length === 0) {
      catSection.remove();
    }

    // 件数更新
    const restCards = document.querySelectorAll('.review-card').length;
    const cnt3 = document.querySelector('#review-count');
    if (cnt3) cnt3.textContent = `${restCards}件`;

    // 全体が空ならメッセージ
    if (restCards === 0) {
      document.querySelector('#empty-msg').style.display = 'block';
    }
  }
}

// イベント委譲（削除ボタン）
document.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.action-remove');
  if (removeBtn && document.querySelector('#review-list').contains(removeBtn)) {
    e.preventDefault();
    const id = removeBtn.closest('.review-card')?.dataset.id; // 右辺の ?. はOK
    if (id) removeItem(id, removeBtn);
  }
});

window.addEventListener('DOMContentLoaded', loadList);

