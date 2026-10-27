import { createComponent, Types } from '@iwsdk/core';

/** A destructible city building. Height is in meters (city-local). */
export const Building = createComponent('Building', {
  height: { type: Types.Float32, default: 0.05 },
  width: { type: Types.Float32, default: 0.032 },
  value: { type: Types.Float32, default: 10 },
  alive: { type: Types.Boolean, default: true },
});

/** A tank driving on the perimeter road. */
export const Tank = createComponent('Tank', {
  alive: { type: Types.Boolean, default: true },
  angle: { type: Types.Float32, default: 0 },
  speed: { type: Types.Float32, default: 0.25 },
  cooldown: { type: Types.Float32, default: 2 },
  held: { type: Types.Boolean, default: false },
});

/** Tag for the glowing restart orb shown after a round. */
export const RestartOrb = createComponent('RestartOrb', {});

/** Clickable vehicle (desktop): index into the car list, -1 = helicopter. */
export const Vehicle = createComponent('Vehicle', {
  index: { type: Types.Int32, default: 0 },
});

/** Game-mode menu card (desktop click): 0..3 = mode, 99 = Blitz time switch. */
export const ModeCard = createComponent('ModeCard', {
  index: { type: Types.Int32, default: 0 },
});
