import { describe, expect, it } from 'vitest';
import { COLLECTIBLE, getCard, hasCard } from './registry';
import { OVERRIDES } from './overrides';

// HearthSim CardDefs build 253216：紫羅蘭堡大逃亡已支援的非地標可收藏卡（含迷你系列）。
// 另以四張地標的固定清單檢查全部牌型，避免統計分母漏掉地標。
// 固定官方 ID 清單，避免卡牌生成器日後靜默略過無法解析的卡。
const SUPPORTED_NON_LOCATION_IDS = [
  'CAP_000', 'CAP_001', 'CAP_002', 'CAP_003', 'CAP_004', 'CAP_005', 'CAP_006', 'CAP_101',
  'CAP_102', 'CAP_103', 'CAP_104', 'CAP_105', 'CAP_106', 'CAP_107', 'CAP_400', 'CAP_401',
  'CAP_402', 'CAP_403', 'CAP_404', 'CAP_405', 'CAP_406', 'CAP_407', 'CAP_800', 'CAP_801',
  'CAP_802', 'CAP_803', 'CAP_804', 'CAP_805', 'CAP_806', 'JAIL_007', 'JAIL_029', 'JAIL_030',
  'JAIL_035', 'JAIL_101', 'JAIL_118', 'JAIL_122', 'JAIL_123', 'JAIL_125', 'JAIL_200', 'JAIL_201',
  'JAIL_202', 'JAIL_204', 'JAIL_205', 'JAIL_206', 'JAIL_225', 'JAIL_303', 'JAIL_307', 'JAIL_311',
  'JAIL_312', 'JAIL_313', 'JAIL_315', 'JAIL_319', 'JAIL_321', 'JAIL_326', 'JAIL_327', 'JAIL_328',
  'JAIL_329', 'JAIL_330', 'JAIL_376', 'JAIL_377', 'JAIL_379', 'JAIL_380', 'JAIL_384', 'JAIL_386',
  'JAIL_387', 'JAIL_395', 'JAIL_397', 'JAIL_398', 'JAIL_399', 'JAIL_407', 'JAIL_421', 'JAIL_430',
  'JAIL_432', 'JAIL_433', 'JAIL_434', 'JAIL_435', 'JAIL_436', 'JAIL_440', 'JAIL_441', 'JAIL_442',
  'JAIL_443', 'JAIL_444', 'JAIL_445', 'JAIL_446', 'JAIL_447', 'JAIL_448', 'JAIL_450', 'JAIL_451',
  'JAIL_452', 'JAIL_453', 'JAIL_454', 'JAIL_455', 'JAIL_456', 'JAIL_457', 'JAIL_458', 'JAIL_459',
  'JAIL_460', 'JAIL_461', 'JAIL_462', 'JAIL_470', 'JAIL_474', 'JAIL_500', 'JAIL_501', 'JAIL_502',
  'JAIL_503', 'JAIL_504', 'JAIL_507', 'JAIL_509', 'JAIL_510', 'JAIL_513', 'JAIL_514', 'JAIL_515',
  'JAIL_516', 'JAIL_703', 'JAIL_706', 'JAIL_718', 'JAIL_719', 'JAIL_720', 'JAIL_721', 'JAIL_730',
  'JAIL_732', 'JAIL_733', 'JAIL_734', 'JAIL_735', 'JAIL_800', 'JAIL_801', 'JAIL_802', 'JAIL_803',
  'JAIL_805', 'JAIL_806', 'JAIL_831', 'JAIL_850', 'JAIL_851', 'JAIL_852', 'JAIL_860', 'JAIL_861',
  'JAIL_866', 'JAIL_872', 'JAIL_875', 'JAIL_876', 'JAIL_878', 'JAIL_879', 'JAIL_880', 'JAIL_881',
  'JAIL_882', 'JAIL_883', 'JAIL_890', 'JAIL_891', 'JAIL_892', 'JAIL_906', 'JAIL_909', 'JAIL_912',
  'JAIL_913', 'JAIL_940', 'JAIL_941', 'JAIL_942', 'JAIL_974', 'JAIL_986', 'JAIL_997', 'JAIL_998',
];

describe('紫羅蘭堡大逃亡卡牌資料', () => {
  it('保留已收錄的 160 張非地標卡（不代表官方全系列完整）', () => {
    expect(COLLECTIBLE.filter((c) => c.set === 1988 && c.type !== 'LOCATION').map((c) => c.id).sort()).toEqual(SUPPORTED_NON_LOCATION_IDS);
  });

  it('全系列164張包含四張官方地標', () => {
    expect(COLLECTIBLE.filter((c) => c.set === 1988)).toHaveLength(164);
    expect(COLLECTIBLE.filter((c) => c.set === 1988 && c.type === 'LOCATION').map((c) => c.id).sort()).toEqual(['JAIL_511', 'JAIL_877', 'JAIL_887', 'JAIL_987']);
  });

  it('保留官方繁體中文資料及特殊效果需要的衍生卡', () => {
    for (const id of SUPPORTED_NON_LOCATION_IDS) {
      const card = getCard(id);
      expect(card.name.trim(), id).not.toBe('');
      expect(card.text, id).toMatch(/[\u3400-\u9fff]/);
      expect(card.dbfId, id).toBeGreaterThan(0);
      for (const token of OVERRIDES[id]?.tokens ?? []) expect(hasCard(token), `${id} → ${token}`).toBe(true);
    }
    expect(getCard('JAIL_430')).toMatchObject({
      name: '斬魂者阿薩琳娜', cost: 7, attack: 7, health: 7, cardClass: 'PRIEST',
    });
    expect(getCard('JAIL_397')).toMatchObject({
      name: '指揮官碧翠絲', cost: 5, attack: 5, health: 6, keywords: ['TAUNT'],
    });
  });
});
