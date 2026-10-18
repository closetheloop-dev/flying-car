/**
 * What each setting, settings group and flight model means, in plain words: one source for
 * the Lab's hints, the Guide (/guide/, rendered at build time) and the WebMCP
 * tools' setting descriptions. `diagram` and `mark` pick the reference page's drawing and
 * what it highlights (src/build/setting-diagrams.ts).
 */
import type { FlightMode, SettingKey } from './settings';

export type Diagram = 'path' | 'timeline' | 'roll' | 'side' | 'top' | 'gas' | 'controller';

export interface SettingDoc {
  /** One sentence: what it is and what changing it does. */
  hint: string;
  /** A few sentences more, for the reference page. */
  detail: string;
  diagram: Diagram;
  /** The part of the diagram to highlight. */
  mark: string;
}

export const MODE_DOCS: Record<FlightMode, { name: string; text: string }> = {
  controlled: {
    name: 'Closed-loop',
    text:
      'A simulated flight controller flies the planned path through gusts, thruster errors, valve lag and a ' +
      'center of mass that is not quite where it thinks, correcting as it goes. The forces shown are what the ' +
      'thrusters actually delivered. The Closed-loop flight settings tune those errors and the controller.',
  },
  ideal: {
    name: 'Ideal',
    text:
      'The exact thrust the planned path needs, worked back from the motion: no errors and no corrections. ' +
      'The closed-loop settings do not apply.',
  },
};

export const FOLDER_DOCS: Record<string, string> = {
  'Maneuver (measured from footage)':
    'The hop as filmed: its timing, height, range and roll, measured frame by frame from the four camera ' +
    'views. Times "on screen" are as seen in the video.',
  Vehicle: 'The Roadster itself: how heavy it is, where its weight sits, and how hard it is to spin.',
  'Propulsion (cold gas N₂)':
    'The cold-gas thrusters and their nitrogen: how much push each gives, and how much gas that takes.',
  'Ground & air': 'Landing on the suspension, the slide afterwards, and air drag.',
  'Closed-loop flight':
    'Only in the Closed-loop model: the errors the flight controller has to fight, and how hard it fights them.',
};

/** Every setting's entry (tests/setting-docs.test.ts checks none is missing or stray). */
export const SETTING_DOCS: Partial<Record<SettingKey, SettingDoc>> = {
  footageSlowdown: {
    hint: 'How slowed-down the footage is: 1 = real time, 2 = played at half speed.',
    detail:
      'Every "on screen" time is divided by this to get real time. At 2 the car would have to fall faster than ' +
      'gravity allows, so the plan fails; that is good evidence the video is real-time.',
    diagram: 'timeline',
    mark: 'slowmo',
  },
  airTimeVideo: {
    hint: 'Time from liftoff to touchdown, as seen in the video.',
    detail:
      'With the hop height it sets how hard the car must be pushed up and how hard it must brake. A higher hop needs ' +
      'a longer air time, and a different roll (or none) changes it too; the Tweak card fits it for you.',
    diagram: 'timeline',
    mark: 'air',
  },
  apexHeight: {
    hint: 'How high the car’s center of mass gets at the top of the hop.',
    detail:
      'Measured against the Semi and the solved front camera: about 8.5 m (28 ft). The launch burn is sized to ' +
      'reach exactly this height.',
    diagram: 'path',
    mark: 'apex',
  },
  range: {
    hint: 'Ground distance from liftoff to touchdown; a longer hop means a faster car.',
    detail:
      'The approach speed is solved so the car covers this distance in the air time. Too short, and the car takes ' +
      'off too close to the stage and hits it.',
    diagram: 'path',
    mark: 'range',
  },
  apexX: {
    hint: 'Where the top of the hop falls along the line, measured past the Semi.',
    detail:
      'Positive is past the Semi (toward the landing). It shifts where liftoff and touchdown sit relative to the ' +
      'parked cars, which decides what the car clears and by how much.',
    diagram: 'path',
    mark: 'apexX',
  },
  sustainThrustG: {
    hint: 'Lift-jet thrust kept on between the launch and landing burns, as a fraction of the car’s weight.',
    detail:
      'It turns with the car as it rolls: up while upright, sideways while the roof faces the parked cars (the ' +
      'sideways drift in the footage comes from this), and down while upside down.',
    diagram: 'side',
    mark: 'lift',
  },
  invertedThrustG: {
    hint: 'Extra lift-jet thrust while the car is upside down, which pulls it back down sooner.',
    detail:
      'Upside down, the lift jets push the car toward the ground, so this shortens the fall after a high apex. It ' +
      'fades out by 90° of roll either side. The footage does not need it, so it is off by default.',
    diagram: 'roll',
    mark: 'inverted',
  },
  launchBurnVideo: {
    hint: 'How long the strong launch burn lasts, as seen in the video.',
    detail:
      'Its strength is solved so the car reaches the hop height. A shorter burn needs more thrust for the same ' +
      'height, and a harder kick for the driver.',
    diagram: 'timeline',
    mark: 'launch',
  },
  touchdownSpeed: {
    hint: 'How fast the car is still falling when its wheels touch, after the landing burn.',
    detail:
      'The landing burn is solved to brake to this speed exactly at the air time; the suspension takes the rest. ' +
      'Zero needs a perfectly timed burn; faster lands harder.',
    diagram: 'timeline',
    mark: 'landing',
  },
  rollStartVideo: {
    hint: 'When the barrel roll begins after liftoff, as seen in the video.',
    detail: 'The roll has to finish before touchdown, so a later start leaves less time for it.',
    diagram: 'timeline',
    mark: 'rollStart',
  },
  rollDurationVideo: {
    hint: 'How long the whole roll takes, as seen in the video.',
    detail:
      'A faster roll needs more roll torque, so the left and right lift thrusters fire more unevenly. It also ' +
      'changes how long the thrust points sideways and down, so it changes the air time the hop needs.',
    diagram: 'timeline',
    mark: 'roll',
  },
  rollRampVideo: {
    hint: 'How long the roll takes to spin up to its full rate.',
    detail: 'A quick spin-up needs a burst of roll torque at the start of the roll.',
    diagram: 'timeline',
    mark: 'ramp',
  },
  rollStopVideo: {
    hint: 'How long the roll takes to stop, at the overshoot past level.',
    detail: 'A quick stop needs a burst of roll torque the other way, near the end of the flight.',
    diagram: 'timeline',
    mark: 'stop',
  },
  rollOvershootDeg: {
    hint: 'How far past level the roll goes before it is corrected back.',
    detail: 'The footage shows the car stopping about 6° past level, then righting itself just before landing.',
    diagram: 'roll',
    mark: 'overshoot',
  },
  rollSettleVideo: {
    hint: 'How long the car takes to roll back from the overshoot to level.',
    detail: 'The correction happens just before touchdown; a quick one needs more roll torque then.',
    diagram: 'timeline',
    mark: 'settle',
  },
  rollTurns: {
    hint: 'How many full barrel rolls; negative rolls toward the parked cars’ noses.',
    detail:
      'The stunt does one roll toward the noses. More rolls in the same roll time spin faster; the direction ' +
      'decides which way the sideways drift goes.',
    diagram: 'roll',
    mark: 'turns',
  },
  mass: {
    hint: 'The car’s mass at liftoff, nitrogen included.',
    detail:
      'Every force scales with it: a heavier car needs more thrust (and more gas) for the same hop, until a thruster ' +
      'reaches its rating. The car gets lighter as it uses gas.',
    diagram: 'side',
    mark: 'mass',
  },
  cgHeight: {
    hint: 'How high the center of mass sits above the ground, at rest.',
    detail: 'Heights in the hop are measured at the center of mass, so this is where the hop starts and ends.',
    diagram: 'side',
    mark: 'cg',
  },
  inertiaScale: {
    hint: 'How hard the car is to spin, compared with a solid box of the same size and mass.',
    detail:
      'Real cars have their weight spread unevenly; 0.8 means a bit easier to spin than a box. Higher needs more roll ' +
      'torque for the same roll.',
    diagram: 'roll',
    mark: 'inertia',
  },
  isp: {
    hint: 'How much push each kilogram of nitrogen gives (specific impulse).',
    detail: 'Cold nitrogen gives about 70 s. Higher means less gas for the same thrust; it does not change the forces.',
    diagram: 'gas',
    mark: 'isp',
  },
  liftThrusterMax: {
    hint: 'The most each of the four down-firing lift thrusters can push.',
    detail:
      'If the flight asks for more, the run is flagged: the controller can only command up to this. The launch burn ' +
      'and a heavy car are where it runs out first.',
    diagram: 'side',
    mark: 'liftRating',
  },
  rcsThrusterMax: {
    hint: 'The most each of the two front side thrusters can push.',
    detail:
      'They sit low at the front corners and push sideways. Being below the center of mass and ahead of it, each ' +
      'one both rolls and turns the car; the left one fires as the roll begins.',
    diagram: 'side',
    mark: 'rcs',
  },
  tankPressure: {
    hint: 'The nitrogen tanks’ storage pressure.',
    detail: 'Higher pressure fits the same gas in smaller tanks; it sets the tank volume and mass in the results.',
    diagram: 'gas',
    mark: 'tank',
  },
  usableFraction: {
    hint: 'How much of the stored nitrogen can actually be used before the pressure gets too low.',
    detail: 'The tanks are sized so the usable part covers the gas the hop needs.',
    diagram: 'gas',
    mark: 'usable',
  },
  suspensionTravel: {
    hint: 'How far the suspension can compress to absorb the touchdown.',
    detail: 'More travel spreads the landing over a longer stop, so the load on the tires is lower.',
    diagram: 'side',
    mark: 'suspension',
  },
  brakingDecel: {
    hint: 'How hard the car slows down in the slide after landing.',
    detail: 'It decides how far the car slides past touchdown before it stops.',
    diagram: 'top',
    mark: 'brake',
  },
  driftYawDeg: {
    hint: 'How far the car swings around while it slides after landing.',
    detail:
      'The stunt brakes straight ahead (0°); a larger value turns the car smoothly by that much as it slides ' +
      'to a stop, like a landing that swings into a burnout.',
    diagram: 'top',
    mark: 'yaw',
  },
  cdaTop: {
    hint: 'How much air drag the car feels moving up or down (drag area seen from above).',
    detail: 'Mostly felt while climbing and falling fast; it slightly changes the thrust the hop needs.',
    diagram: 'top',
    mark: 'cda',
  },
  gustStd: {
    hint: 'How strong the wind gusts are.',
    detail: 'Gusts change the drag at random; the controller has to correct the drift they cause.',
    diagram: 'controller',
    mark: 'gust',
  },
  thrustScatter: {
    hint: 'How far each thruster’s steady output is from what it is told (a fixed error per thruster).',
    detail: 'Like a thruster that is a few percent stronger or weaker than its spec; the controller corrects for it.',
    diagram: 'controller',
    mark: 'scatter',
  },
  thrustNoise: {
    hint: 'How much the thrust flickers from moment to moment.',
    detail: 'A random fluctuation redrawn every control cycle.',
    diagram: 'controller',
    mark: 'noise',
  },
  cgOffset: {
    hint: 'How far the real center of mass is from where the controller thinks it is.',
    detail: 'The thrust then turns the car a little unexpectedly, which the controller has to catch.',
    diagram: 'controller',
    mark: 'cg',
  },
  inertiaError: {
    hint: 'How wrong the controller is about how hard the car is to spin.',
    detail: 'The rolls then come out a little too fast or too slow, and the controller corrects.',
    diagram: 'controller',
    mark: 'inertia',
  },
  valveLag: {
    hint: 'How long the thruster valves take to respond to a new command.',
    detail: 'The controller leads its commands by this; longer lags make corrections late.',
    diagram: 'controller',
    mark: 'valve',
  },
  minOpening: {
    hint: 'The smallest steady valve opening; anything less is done by pulsing the valve.',
    detail: 'Small thrusts flicker on and off instead of flowing steadily.',
    diagram: 'controller',
    mark: 'minOpen',
  },
  controlRate: {
    hint: 'How many times a second the flight controller updates its commands.',
    detail: 'Slower updates react later to errors.',
    diagram: 'controller',
    mark: 'rate',
  },
  posBandwidth: {
    hint: 'How tightly the controller pulls the car back onto the planned path.',
    detail: 'Higher corrects position errors faster but works the thrusters harder.',
    diagram: 'controller',
    mark: 'pos',
  },
  attBandwidth: {
    hint: 'How tightly the controller holds the planned attitude (the roll).',
    detail: 'Higher corrects the attitude faster but asks for sharper roll torques.',
    diagram: 'controller',
    mark: 'att',
  },
  seed: {
    hint: 'Which random draw of gusts and thruster errors to use.',
    detail: 'The same seed always gives the same flight; "New disturbance draw" picks another.',
    diagram: 'controller',
    mark: 'seed',
  },
};
