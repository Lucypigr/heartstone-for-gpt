import { expect, it } from 'vitest';
import { parseCardDefs } from '../../scripts/carddefs';

it('preserves enum IDs when secondary-race tags share a placeholder name', () => {
  const [card] = parseCardDefs(`<Entity CardID="TEST" ID="1">
    <Tag enumID="200" name="CARDRACE" type="Int" value="24"/>
    <Tag enumID="2540" name="1" type="Int" value="1"/>
    <Tag enumID="2534" name="1" type="Int" value="0"/>
  </Entity>`);
  expect(card.tags.CARDRACE).toBe(24);
  expect(card.tags['200']).toBe(24);
  expect(card.tags['2540']).toBe(1);
  expect(card.tags['2534']).toBe(0);
});
