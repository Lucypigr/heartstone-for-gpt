# 爐石戰記 for GPT

一個用網頁做的爐石戰記（Hearthstone）風格卡牌遊戲。卡牌資料和 [hsreplay.net](https://hsreplay.net/zh-hant/cards/) 使用同一份官方資料（HearthSim 的 `CardDefs.xml`），有繁體中文卡名與敘述。

這是從 Claude 版複製出的獨立專案，目前保留相同的遊戲功能，供 GPT 版後續調整。

- ⚔️ **對戰電腦**：規則和爐石差不多（法力水晶、英雄能力、嘲諷、聖盾、衝鋒、突襲、風怒、潛行、劇毒、生命竊取、復生、冰凍、沉默、亡語、戰吼、連擊、超載、奧秘、發現、二選一、回音、雙生法術、比武、翠玉魔像、號召、滅殺、克蘇恩、星艦、死亡騎士的屍體與符文、抽中時施放、消耗生命值 / 屍體的卡……）
- 🏆 **天梯**：像真人配對一樣排天梯（青銅 → 白銀 → 黃金 → 白金 → 鑽石 → 傳說），有星星、連勝加成、保底與每月賽季獎勵。配對到的「玩家」其實都是電腦，但每個人都不一樣：有新手也有高手、有主流套牌也有奇葩套路或亂組的牌；會打招呼、會說「打得好」、偶爾按錯、沒救了會投降。牌階越高，對手越強
- 🤖 **練習模式**：簡單 / 普通 / 困難三種電腦，難度越高，電腦的套牌越強，出牌也越聰明
- 🪙 **金幣獎勵**：打贏電腦拿金幣（困難與高牌階天梯最多），還有每日首勝與天梯賽季獎勵
- 🛒 **商店與卡包**：用金幣買卡包，每包隨機掉 5 張卡（至少 1 張稀有以上，30 包保底傳說）
- 📚 **收藏與組牌**：自由組 30 張的套牌；也可以開啟「不限職業」，把任何職業的卡放在一起。死亡騎士套牌最多 3 個符文
- ✨ **合成與分解**：重複的卡可以分解成奧術之塵，用來合成想要的卡
- 📋 **牌組代碼**：可以直接貼上 hsreplay.net 或爐石戰記的牌組代碼匯入套牌，也能匯出自己的套牌；缺少的卡可以一鍵合成
- 💾 **自動存檔**：進度存在瀏覽器裡，可以匯出 / 匯入

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
npm run dev      # 開發模式，打開 http://localhost:5173
npm run build    # 輸出到 dist/，可以直接放到任何靜態網站
npm test         # 執行測試
```

## 線上試玩（GitHub Pages）

推送到 `main` 後會自動建置並部署到 `https://lucypigr.github.io/heartstone-for-gpt/`（設定檔在 `.github/workflows/deploy.yml`）。
第一次使用前要到 GitHub 專案的 **Settings → Pages**，把 **Source** 設為 **GitHub Actions**。

## 卡牌資料

`src/data/cards.json` 是由 `scripts/build-cards.ts` 產生的：

```bash
npm run cards
```

這個指令會：

1. 下載 HearthSim 的 `CardDefs.xml`（快取在 `.cache/`）
2. 取出所有可收藏卡（手下、法術、武器），同名卡只保留一個版本
3. 把**英文卡牌敘述解析成效果 DSL**（`src/cards/parser.ts`），例如「Battlecry: Deal 3 damage.」→ `{ on: play, effects: [damage 3 → 選擇目標] }`
4. **只收錄效果能完整執行的卡**，避免遊戲裡出現效果錯誤的卡；目前約 2,000 張
5. 顯示用的卡名與敘述使用官方繁體中文（zhTW）

無法支援的卡與原因會寫到 `.cache/unsupported.txt`，方便之後補上。

卡圖由 [HearthstoneJSON](https://hearthstonejson.com/) 提供（`art.hearthstonejson.com`），載入失敗時會顯示職業色塊。

## 專案結構

```
src/
  engine/          對戰引擎（和畫面無關，可以單獨測試）
    types.ts       卡牌定義與效果 DSL 的型別
    state.ts       對戰狀態
    game.ts        規則、戰鬥、觸發、效果執行、死亡處理
    ai.ts          電腦對手（簡單 / 普通：模擬每個動作挑最好的；困難：整回合 beam search；
                   AiBrain：天梯對手的個性——技術、打法、失誤、投降、表情、思考時間）
    heroes.ts      各職業的英雄能力
  cards/
    parser.ts      英文敘述 → 效果 DSL 的解析器
    registry.ts    卡牌資料庫
    overrides.ts   手動定義效果的卡（解析器看不懂的經典卡）
    custom.ts      自訂的原創卡牌
  game/
    profile.ts     存檔、金幣、卡包、合成分解、戰績
    decks.ts       組牌規則、自動組牌、卡牌強度評估
    deckstring.ts  牌組代碼編碼 / 解碼
    economy.ts     所有經濟數值（獎勵、價格、機率）
    sets.ts        系列名稱與卡包種類
    opponents.ts   電腦的套牌
    ladder.ts      天梯：牌階、星星、賽季，以及配對對手（名稱、技術、套牌風格）
  ui/              React 畫面
scripts/
  build-cards.ts   產生卡牌資料
```

## 之後要加內容？

| 想做的事 | 改哪裡 |
| --- | --- |
| 新增原創卡牌 | `src/cards/custom.ts`（有範例，不用重新產生資料） |
| 讓某張官方卡可以玩 | `src/cards/overrides.ts`，然後 `npm run cards` |
| 調整金幣獎勵、卡包價格、掉落機率 | `src/game/economy.ts` |
| 新增卡包種類 | `src/game/sets.ts` 的 `PACKS` |
| 新增效果類型 | `src/engine/types.ts` 的 `Effect`，並在 `src/engine/game.ts` 的 `runEffect` 實作 |
| 特殊的一次性效果 | 用 `{ e: 'custom', fn: '名稱' }`，在 `game.ts` 的 `custom()` 實作 |
| 調整電腦強度 | `src/engine/ai.ts`（評估函數）與 `src/game/opponents.ts`（電腦套牌） |
| 調整天梯對手（技術分布、套牌種類、奇葩套路、名稱） | `src/game/ladder.ts` 的 `findOpponent`、`MEMES`、`ARCHETYPES` |
| 調整天梯規則與獎勵 | `src/game/ladder.ts`（星星、保底、連勝、賽季獎勵） |

效果 DSL 範例（戰吼：對一個敵方手下造成 2 點傷害，抽一張牌）：

```ts
{
  target: { filter: { type: 'minion', side: 'enemy' }, optional: true },
  abilities: [
    {
      on: { k: 'play' },
      effects: [
        { e: 'damage', target: { t: 'chosen' }, amount: 2 },
        { e: 'draw', count: 1, who: 'self' },
      ],
    },
  ],
}
```

## 目前還不支援的機制

任務、磁力、腐化、休眠、灌注、鍛造、巨型、泰坦、挖掘、疏浚、微縮、死亡騎士符文 / 屍體、地標等。含有這些機制的卡暫時不會出現在收藏與卡包中。

英雄卡目前支援 15 張（賈拉克瑟斯、冰封王座的死亡騎士英雄（含死屍獸王雷克薩的殭屍獸）、葛拉克朗基本形態、製影者史蓋伯斯），定義在 `src/cards/overrides.ts`；其他英雄卡因為需要尚未實作的機制而暫不收錄。

## 聲明

爐石戰記（Hearthstone）與所有卡牌名稱、圖片為 Blizzard Entertainment 的財產。本專案是非官方的個人學習作品，與 Blizzard 無關。
