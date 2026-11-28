# Liquid Glass для Aether (стиль WWDC25/WWDC26, iOS/macOS 27)

Зразок у коді: `src/styles/theme.css` (токени), `src/styles/app.css` (dock, header-контроли, `.menu`). Скріншот: `docs/design/liquid-glass-sample.png`.
Генератори: `node scripts/gen-springs.mjs` (пружини), `node scripts/glass-contrast.mjs` (контраст).

## 1. Джерела (лише Apple) і що з них узято

Примітка: сторінки HIG (`developer.apple.com/design/human-interface-guidelines/materials`, `/accessibility`) повертають при завантаженні лише заголовок (клієнтський рендер), тому їх я НЕ прочитав напряму. Тези про regular/clear, шари, заборону накладання скла і dimming взято з відео нижче, які Apple повторює в HIG. Перегляньте HIG вручну, якщо потрібне дослівне формулювання.

| Джерело | Що взято |
| --- | --- |
| https://developer.apple.com/videos/play/wwdc2025/219/ (Meet Liquid Glass) | Lensing (світло згинається, а не розсіюється; поява через зміну lensing, а не fade); specular highlights реагують на геометрію; adaptive shadow (щільніша над текстом, легша над світлим фоном); interactivity (стискається/світиться зсередини); morphing (одна площина, меню розкриваються з кнопки); regular = універсальний, clear = завжди прозоріший, лише над медіа + потрібен dimming, regular і clear не змішувати; більше скло = товстіший матеріал, глибша тінь |
| https://developer.apple.com/videos/play/wwdc2025/356/ (Get to know the new design system) | Функціональний шар над контентом; концентричність (внутрішній радіус = зовнішній − відступ), капсули (радіус = h/2), «pinched/flared» кути = помилка; на Mac capsule для великих/виділених дій, rounded rect для щільних; скло лише на самому контролі, не на внутрішніх view; scroll edge effect (soft за замовчуванням, hard на macOS) замість жорстких роздільників; модальне = скло + dimming; прибрати власні фони/бордери барів; сайдбари — скло, контент тече під ними |
| https://developer.apple.com/videos/play/wwdc2026/102/ (Platforms State of the Union) | Релізи 27: краща дифузія складного фону за склом; затемнений край (depth/separation); яскравіші specular highlights; слайдер «ultra clear ↔ fully tinted»; адаптація до Reduce Transparency / Increase Contrast |
| https://developer.apple.com/videos/play/wwdc2026/289/ (Modernize your AppKit app) | macOS 27: сайдбар до країв вікна; interactive glass: скло легко «підстрибує» при кліку, застосовувати до контролів, а не до всього скла («a little goes a long way»); scroll edge стає hard під вільним заголовком вікна |
| https://developer.apple.com/videos/play/wwdc2026/269/ (What's new in SwiftUI) | Interactive glass на iOS/macOS; неактивне вікно приглушує іконки/текст (`appearsActive`): врахувати пізніше; оновлений вигляд приходить автоматично. Про darkened edge / specular / scroll edge ця сторінка НЕ говорить (вони з 102/289) |
| https://developer.apple.com/videos/play/wwdc2023/10158/ (Animate with springs) | Модель duration + bounce; bounce 0 за замовчуванням, ~0.15 «трохи жвавіше», ~0.3 помітно пружинить, >0.4 перебір для UI; спершу тривалість, потім bounce; послідовний характер пружини в застосунку; settling time непередбачуваний |
| SwiftUI `Animation.smooth/.snappy/.bouncy` | Пресети (bounce 0 / невеликий / більший). Окремої сторінки документації я не відкривав; значення bounce 0.15/0.3 для snappy/bouncy — моя інтерпретація |

Моє калібрування (не значення Apple): конкретні числа blur/альфи/тіней.

## 2. Шарова модель Aether

HIG: скло = функціональний шар над контентом; контент не скляний; скло на склі не накладається.

| Шар | Поверхні | Матеріал |
| --- | --- | --- |
| Функціональний (Liquid Glass regular) | `.aether-dock`, `.menu`, `.suggestion-container`, `.aether-segmented`, `.aether-button`, `.aether-header-icon`, `.modal` (з dimming `.modal-bg`), `.notice`, палітра команд (`.modal.prompt`) | `--glass-*` |
| Структурний (без власного blur) | сайдбари `.mod-left-split`/`.mod-right-split` до країв вікна, смуга вкладок | напівпрозора заливка + hard scroll-edge під заголовком |
| Контент (НЕ скло) | редактор, reading view, граф, полотно, `.canvas-node` | `--background-primary` та прозорі заливки |
| Clear glass | не використовується в v1; резерв для плаваючих тулбарів над зображеннями на полотні, завжди з `--glass-dim` | `--glass-clear-*` |

Картки полотна: картка = контент, не скло. Вона лежить на тому ж шарі, що й нотатка; скло над нею лише тулбар виділеної картки. Тому в картках треба прибрати `backdrop-filter: blur(12px)` (зараз він на кожній картці: дорого і це скло на контенті), радіус `--r-panel`, м'яка тінь, виділення = кільце акценту. Glass лишається ознакою «плаваючого/інтерактивного».

Правило «без накладання»: скляний елемент усередині скляної панелі не має власного `backdrop-filter`. Кнопки в `.modal`, `.menu-item`, `.suggestion-item` — просто lit-заливка (`--glass-lit`) без blur. У зразку кнопки header мають blur, бо header не скляна панель, а плоска поверхня вікна.

## 3. Матеріал (dark, `theme.css`)

```css
--glass-fill:      rgba(28, 30, 42, 0.72);   /* regular */
--glass-fill-menu: rgba(28, 30, 42, 0.82);   /* поверхні з текстом: меню, модалки */
--glass-blur:      blur(28px) saturate(190%);
--glass-sheen: linear-gradient(180deg, rgba(255,255,255,.16), rgba(255,255,255,.04) 38%, rgba(255,255,255,0));
--glass-rim:   linear-gradient(145deg, rgba(255,255,255,.62), rgba(255,255,255,.08) 28%, rgba(255,255,255,.04) 60%, rgba(255,255,255,.34));
--glass-edge:  0 0 0 .5px rgba(0,0,0,.55), inset 0 0 14px rgba(255,255,255,.05); /* затемнений край WWDC26 + внутрішнє світіння */
--glass-shadow-s: 0 1px 2px rgba(0,0,0,.3), 0 4px 12px rgba(0,0,0,.22);   /* контроли */
--glass-shadow-l: 0 2px 6px rgba(0,0,0,.3), 0 18px 44px rgba(0,0,0,.42);  /* dock, меню, модалки */
--glass-lit: rgba(255,255,255,.17); --glass-lit-strong: rgba(255,255,255,.26);
--glass-lit-edge: inset 0 1px 0 rgba(255,255,255,.5), inset 0 -1px 0 rgba(255,255,255,.12);
/* clear: лише над медіа, завжди з dimming-шаром */
--glass-clear-fill: rgba(255,255,255,.07); --glass-clear-blur: blur(12px) saturate(170%); --glass-dim: rgba(0,0,0,.28);
```

Рецепт скляного елемента (див. `.aether-dock`):
1. `background-color: var(--glass-fill); background-image: var(--glass-sheen);` + `backdrop-filter: var(--glass-blur)`.
2. `box-shadow: var(--glass-edge), var(--glass-shadow-l|s);` затемнений край + адаптивна тінь (більший елемент = глибша `-l`).
3. `::after` = rim: 1px градієнтний бордер через mask (яскравий верх-ліворуч і низ-праворуч). Потрібні `position: relative|absolute|fixed` на елементі та `border-radius: inherit` на `::after` (у `app.css` вже є grouped-правило; додавай свій селектор до нього).
4. Hover/selected/pressed = `--glass-lit` (шар `::before`) або `color-mix(in srgb, var(--glass-fill), white 14%)` для `background-color`. Градієнти не анімуються, тому `background-color` і `background-image` розділені.

Справжньої рефракції (lensing) в CSS немає; найближче: `saturate(190%)` + внутрішнє світіння + rim. Displacement-фільтр у `backdrop-filter` Chromium не підтримує.

## 4. Форма

Концентричність: дочірній радіус = батьківський − відступ.

| Токен | px | Де |
| --- | --- | --- |
| `--r-window` | 22 | модалки, палітра |
| `--r-panel` | 18 | `.menu`, поповери, картки полотна |
| `--r-control` | 12 | пункти списків усередині панелі (18 − 6 = 12), поля вводу |
| `--r-inner` | 8 | бейджі, kbd, inline-code |
| `--r-capsule` | 999 | кнопки, segmented, dock, пілюлі (радіус = h/2) |

Розміри: контрол 32 (header) / 36 (dock), padding скляної групи 3 (segmented) / 6 (dock, меню), проміжок у групі 2px, між групами 8–12px. Цілі ≥ 24px (WCAG 2.5.8).

## 5. Рух: пружини

Модель SwiftUI `Spring(duration:, bounce:)`: ω = 2π/duration, ζ = 1 − bounce, одинична маса, нульова початкова швидкість.
- ζ = 1: `x(t) = 1 − (1 + ωt)e^(−ωt)`
- ζ < 1: `x(t) = 1 − e^(−ζωt)(cos ω_d t + (ζω/ω_d) sin ω_d t)`, `ω_d = ω√(1−ζ²)`

`scripts/gen-springs.mjs` семплює 37 точок до відхилення < 0.5% і друкує `linear(...)` та settling time (він і є CSS-тривалістю). Результат (`theme.css`, `:root`):

| Токен | SwiftUI | duration | CSS time |
| --- | --- | --- | --- |
| `--spring-smooth` | `.smooth` (bounce 0) | 0.4 s | `--dur-smooth` 470ms; `--dur-fast` 300ms: та сама крива, коротше |
| `--spring-snappy` | `.snappy` (bounce .15) | 0.3 s | `--dur-snappy` 320ms |
| `--spring-bouncy` | `.bouncy` (bounce .3) | 0.45 s | `--dur-bouncy` 500ms |

```
--spring-smooth: linear(0, 0.0187, 0.0652, 0.1287, 0.201, 0.2768, 0.3521, 0.4245, 0.4925, 0.5552, 0.6121, 0.6633, 0.709, 0.7493, 0.7847, 0.8156, 0.8425, 0.8658, 0.8859, 0.9031, 0.9179, 0.9306, 0.9414, 0.9505, 0.9583, 0.9649, 0.9705, 0.9753, 0.9793, 0.9826, 0.9854, 0.9878, 0.9898, 0.9915, 0.9929, 0.9941, 1);
--spring-snappy: linear(0, 0.016, 0.0574, 0.116, 0.1854, 0.2604, 0.3373, 0.4131, 0.486, 0.5545, 0.6177, 0.6751, 0.7267, 0.7724, 0.8125, 0.8472, 0.8771, 0.9025, 0.9239, 0.9417, 0.9564, 0.9684, 0.9781, 0.9858, 0.9918, 0.9964, 0.9999, 1.0024, 1.0041, 1.0053, 1.0059, 1.0062, 1.0063, 1.0061, 1.0058, 1.0054, 1);
--spring-bouncy: linear(0, 0.0173, 0.063, 0.1287, 0.2076, 0.2939, 0.383, 0.4712, 0.5558, 0.635, 0.7073, 0.7721, 0.8289, 0.8779, 0.9192, 0.9533, 0.9808, 1.0024, 1.0188, 1.0306, 1.0386, 1.0434, 1.0457, 1.0458, 1.0445, 1.042, 1.0387, 1.0349, 1.0308, 1.0267, 1.0227, 1.0189, 1.0154, 1.0122, 1.0094, 1.0069, 1);
```

Не правити руками: змінюєш duration/bounce в скрипті, перегенеровуєш. Overshoot snappy ≈ 0.6%, bouncy ≈ 4.6%.

| Взаємодія | Пружина | Деталі |
| --- | --- | --- |
| hover (колір, підсвітка) | smooth, `--dur-fast` | без руху |
| press down (scale .96, dock .94, заливка +24% білого) | smooth, `--dur-fast` | без overshoot, миттєво |
| press release | snappy | transform повертається з легким overshoot |
| меню / поповер | snappy, `scale .9→1` + opacity, `transform-origin` у куті біля курсора | `@keyframes glass-pop` |
| модалка | smooth, `scale .96→1` + opacity, dimming fade 200ms | великі поверхні без bounce |
| перемикання вкладки / segmented thumb | bouncy (`::before`, scale .8→1) | |
| dock: hover/вибір | bouncy (`::before`, scale .82→1) | |
| select картки на полотні | snappy (кільце + scale до 1.01) | |
| drag | без пружини під час руху (пряма маніпуляція), bouncy при відпусканні | |

Interactive glass (WWDC26): `:active` → scale .96 + заливка світлішає; відпускання snappy. Застосовувати лише до контролів.

## 6. Доступність

Контраст (`node scripts/glass-contrast.mjs`: текст композититься на заливку, яка композититься на фон):

| Заливка | Фон | text-normal | text-muted | text-faint |
| --- | --- | --- | --- | --- |
| regular .72 | #151a26 | 15.4 | 7.6 | 6.2 |
| regular | #3b5b8f | 12.3 | 6.4 | 5.4 |
| regular | #808080 | 10.5 | 5.7 | 4.8 |
| regular | білий | 6.0 | 3.6 (fail) | 3.2 (fail) |
| menu .82 | білий | 8.5 | 4.8 | 4.2 (fail) |
| solid fallback | будь-який | 13.4 | 6.8 | 5.7 |

Усе ≥ 4.5 до середньо-сірого фону. На чисто білому під склом muted/faint падають. Правила: (1) на склі змістовний текст лише `--text-normal`/`--text-muted`, не `--text-faint`; (2) поверхні з текстом (меню, модалки, палітра) = `--glass-fill-menu`; (3) sheen додає до 16% білого у верхній смузі і я цей випадок не міряв: якщо ставиш muted-текст у верхніх ~12px скла, перевір.

- Фокус: `--focus-ring` (2px #6cb4ff з проміжком кольору фону), ≥ 3:1. Глобальне `:focus-visible` ставить `border-radius: var(--radius-s)` і `box-shadow`, тому на скляних елементах додавай `:focus-visible { box-shadow: var(--glass-edge), var(--focus-ring); border-radius: var(--r-capsule) }`.
- `prefers-reduced-transparency: reduce` і `prefers-contrast: more` (у `theme.css`): `--glass-fill*` стають `--glass-solid`, `--glass-blur: none`, sheen вимкнено; для contrast more rim = суцільна 75% біла лінія. Електронна версія Chromium може не підтримувати `prefers-reduced-transparency`: я це не перевіряв; додай перемикач у налаштування, що ставить клас на `body` з тими самими змінними.
- `prefers-reduced-motion: reduce`: глобальний блок у кінці `app.css` тепер не вимикає все, а лишає 120ms ease-out для `opacity, background-color, color, border-color`; transform/animation вимкнені; `.menu` використовує `glass-fill` fade. Я змінив цей загальний блок.
- Disabled: opacity .45. Стан не лише кольором: активне має lit-пілюлю і `aria-pressed`.

## 7. Чекліст компонентів (клас `app.css` → обробка)

G = скло regular, L = lit-заливка без blur (усередині скла), C = контент (не скло), K = без змін.

| Клас(и) | Обробка |
| --- | --- |
| `body`, `html`, `.sr-only`, `.svg-icon`, `.app-container` | K |
| `kbd` | радіус `--r-inner` |
| `.clickable-icon` | K, крім header (`.aether-header-icon`: G, коло 32px, готово) |
| `.mod-left-split`, `.mod-right-split` | структурний: без бордера, роздільник `box-shadow: inset -1px 0 rgba(255,255,255,.06)`, до країв вікна |
| `.aether-search` | капсула `--r-capsule`, заливка `rgba(255,255,255,.06)`, слабкий rim; focus-within = focus-ring |
| `.workspace-sidedock-leaves`, `.view-header*`, `.pane-empty` | K |
| `.tree-item-self`, `.nav-file-title`, `.nav-folder-title` | радіус `--r-control`; hover = `--glass-lit` 55%; `.is-active` = акцент + `--glass-lit-edge`, без зміни layout |
| `.collapse-icon` | transform через `--spring-snappy` / `--dur-snappy` |
| `.nav-file-tag`, `.tag-pane-tag`, `.tag-pane-tag-count` | капсула, lit-заливка, без blur |
| `.aether-sidebar-footer`, `.status-bar*` | K, м'якший роздільник |
| `.mod-root`, `.aether-header` | прибрати `border-bottom`, замінити hard scroll-edge: `box-shadow: 0 1px 0 rgba(255,255,255,.06)` |
| `.aether-vault-name` | K |
| `.aether-segmented`, `.aether-button`, `.aether-header-icon` | **готово** |
| `.aether-button.mod-cta`, `button.mod-cta` | **готово**: акцентна заливка (білий текст ≥ 5.4:1), без скляного fill |
| `.workspace-tabs`, `.workspace-tab-header-container*`, `.workspace-tab-header*` | вкладки = капсули; активна `--glass-lit` + `--glass-lit-edge` з `::before` bouncy (як segmented); close = коло 24px; прибрати `border-top` у `.workspace-tab-container` |
| `.view-content`, `.empty-state*` | C |
| `.markdown-source-view`, `.cm-*`, `.HyperMD-*`, `.markdown-preview-view`, `.markdown-rendered*` | C; `pre` радіус `--r-control`, inline-code/теги `--r-inner` |
| `.aether-dock*`, `.aether-zoom`, `.aether-dock-plugins`, `.side-dock-ribbon-action` | **готово** |
| `.modal-container`, `.modal-bg` | `.modal-bg` = `--glass-dim` + `backdrop-filter: blur(6px)`, fade 200ms smooth |
| `.modal`, `.modal-title`, `.modal-close-button`, `.modal-content` | G, `--glass-fill-menu`, `--r-window`, `--glass-shadow-l`, rim; поява smooth `scale .96→1` (без bounce) |
| `.modal.mod-settings`, `.vertical-tab-*`, `.setting-item*` | L: пункти радіус 12, hover lit, active акцент; роздільники `rgba(255,255,255,.08)` |
| `.setting-item-control button`, `.modal button`, `.dropdown`, поля | L-капсули для кнопок, поля `--r-control`; без blur; press scale .96 |
| `.checkbox-container` | iOS-тумблер 51×31, thumb 27px з тінню, transform `--spring-bouncy`, фон `--spring-smooth` |
| `.modal.prompt`, `.prompt-*`, `.suggestion-item`, `.suggestion-*`, `.suggestion-container` | G як `.menu` (у зразку `.suggestion-container` свідомо лишено старим: переведи на ті самі правила), елементи L радіус 12 |
| `.notice-container`, `.notice` | G, радіус `--r-panel`, поява snappy знизу `translateY(8px)→0` |
| `.menu`, `.menu-item`, `.menu-separator`, `.menu-item-icon` | **готово** |
| `.mod-welcome`, `.aether-welcome` | K |
| `.nav-files-container.is-being-dragged-over` | радіус `--r-control`, заливка lit замість пунктиру |
| `.aether-prompt-input`, `.aether-prompt-error` | поле `--r-control` |
| `.canvas-wrapper`, `.canvas`, `.canvas-edges`, `.canvas-strokes`, `.graph-*`, `.canvas-node-resizer` | C / K |
| `.canvas-node:not(.canvas-node-group)` | C: прибрати `backdrop-filter`, радіус `--r-panel`, тінь `--glass-shadow-s`, select = кільце 2px |
| `.canvas-node-group`, `.canvas-group-label`, `.canvas-edge-label` | C; labels = капсули lit |
| `.canvas-node-connection-point::after` | G-капсула 22px, поява scale .6→1 bouncy |
| `.backlink-count`, `.search-result*` | C; `.search-result-file-match` радіус `--r-control` |
| `.modal.mod-catalog`, `.catalog-results` | як `.modal` |
| drag-регіони (`-webkit-app-region`) | не чіпати |

## 8. Відомі межі зразка

- Thumb у segmented/dock не їде між кнопками, а розкривається на місці (scale + opacity, bouncy). Справжній morph = FLIP через JS.
- `.menu` видаляється з DOM без анімації закриття; для exit потрібен клас `.is-closing` у `src/app/ui.ts`.
- Перевірено лише темну тему (світлої в `theme.css` немає).
- Реальної рефракції немає (обмеження CSS).

## 9. Застосовано до всього застосунку (після зразка)

- Усі компоненти з чекліста §7 переведено (блок «Liquid Glass — the rest of the app» у кінці `app.css`).
- Перемикач «Полотно / Нотатки»: один повзунок `.aether-segmented-thumb`, що їде між варіантами (bouncy, `translateX` + `width`, `syncMode` у `app.ts`).
- Меню закривається анімацією `glass-pop-out` (140 мс, швидше за появу), вузол прибирається після неї; без анімації — під `prefers-reduced-motion` і в тестах.
- Неактивне вікно: рамка (бічна панель, шапка, док, вкладки) приглушується до 0.6, вміст — ні.
- Вибраний рядок у дереві та налаштуваннях — світла «пілюля» (`--glass-lit`), не суцільний акцент, як у бічних панелях Apple.
- Модальні вікна лише затемнюють тло (`blur(2px)` + 36% чорного), не розмивають його сильно.
- Картки полотна — непрозорі (`--canvas-card-background`), без `backdrop-filter`.
- Налаштування → «Вигляд» → «Зменшити прозорість»: `body.reduce-transparency` (на випадок, якщо Chromium не передає системне налаштування).
- Не зроблено: анімація закриття модальних вікон і сповіщень, світла тема, справжнє заломлення (lensing) — у CSS його немає.
