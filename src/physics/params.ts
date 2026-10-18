/**
 * Every assumption in the model lives here so it can be tuned from the UI.
 *
 * The default flight matches the original video, one run filmed by four cameras; see the
 * notes on the maneuver below. Vehicle and propulsion figures are estimates — Tesla has
 * published none of them.
 *
 * Times suffixed "Video" are as seen on screen; they are divided by
 * `footageSlowdown` to get real time (2 = the footage is 2× slow-motion).
 */
export interface Params {
  // ── Vehicle ────────────────────────────────────────────────────────────
  /** Liftoff mass including gas and tanks [kg]. */
  mass: number;
  /** Body box dimensions [m]. */
  length: number;
  width: number;
  height: number;
  /** Center of gravity above the road at ride height [m]. */
  cgHeight: number;
  /** Fraction of the uniform-box inertia (real cars concentrate mass low and central). */
  inertiaScale: number;

  // ── Propulsion (cold gas) ──────────────────────────────────────────────
  /** Specific impulse [s]. Nitrogen cold gas is ~65–75 s in practice. */
  isp: number;
  /** Max force of each of the four down-firing lift thrusters [N]. */
  liftThrusterMax: number;
  /** Max force of each attitude (roll / lateral) thruster [N]. */
  rcsThrusterMax: number;
  /** Storage pressure of the gas tanks [Pa]. */
  tankPressure: number;
  /** Fraction of stored gas usable before pressure drops too low. */
  usableFraction: number;
  /** COPV performance factor PV/W [J/kg]; carbon-overwrap tanks are ~2.5e5. */
  copvPerformance: number;

  // ── Maneuver, as measured from the footage ────────────────────────────
  footageSlowdown: number;
  /** Liftoff → touchdown on screen [s]. */
  airTimeVideo: number;
  /** Center-of-gravity height at the top of the hop [m]. */
  apexHeight: number;
  /** Horizontal distance liftoff → touchdown [m]. */
  range: number;
  /** Where the apex falls along the flight line, measured past the Semi (x = 0) [m]. */
  apexX: number;
  /** Duration of the launch burn on screen [s]. */
  launchBurnVideo: number;
  /** Vertical speed at touchdown that the landing burn brakes down to [m/s]. */
  touchdownSpeed: number;
  /** Roll start, after liftoff, on screen [s]. */
  rollStartVideo: number;
  /** Roll duration on screen [s]. */
  rollDurationVideo: number;
  /** Spin-up time of the roll on screen [s]. */
  rollRampVideo: number;
  /** Time to stop the roll at the overshoot peak, on screen [s]. */
  rollStopVideo: number;
  /** How far past level the roll overshoots before it is corrected [deg]. */
  rollOvershootDeg: number;
  /** Time to roll back from the overshoot to level, on screen [s]. */
  rollSettleVideo: number;
  /**
   * Number of full barrel rolls; negative = rolling toward the line-up's noses (the car
   * banks into its sideways drift, as seen in the front and end-on views).
   */
  rollTurns: number;
  /**
   * Lift-jet thrust kept on between the launch and landing burns, as specific force
   * along the car's up axis [g]. Because it turns with the roll it pushes the car toward
   * the line-up's noses while the roof faces them — the sideways drift seen in the
   * end-on shot (≈2 m by touchdown) — and down while the car is inverted.
   */
  sustainThrustG: number;
  /**
   * Extra lift-jet thrust while the car is upside down [g], fading to none at 90° of
   * roll. Inverted, the lift jets push the car down, so this brings it back to the ground
   * sooner after a high apex; being symmetric about inverted it adds little drift.
   */
  invertedThrustG: number;

  // ── Ground phases ──────────────────────────────────────────────────────
  approachDuration: number;
  /** Usable suspension travel at touchdown [m]. */
  suspensionTravel: number;
  /** Braking deceleration in the post-landing slide [m/s²]. */
  brakingDecel: number;
  /** Yaw angle swung through during the landing slide [deg]. */
  driftYawDeg: number;

  // ── Air ────────────────────────────────────────────────────────────────
  airDensity: number;
  /** Drag coefficient × reference area seen from the front / top / side [m²]. */
  cdaFront: number;
  cdaTop: number;
  cdaSide: number;

  // ── Closed-loop flight (closedloop.ts) ─────────────────────────────────
  /** Gust strength, standard deviation of the wind velocity [m/s]. */
  gustStd: number;
  /** Fixed per-thruster thrust error, standard deviation as a fraction of the command. */
  thrustScatter: number;
  /** Fast thrust fluctuation, standard deviation as a fraction, redrawn each control cycle. */
  thrustNoise: number;
  /** Distance of the true center of mass from where the controller assumes it is [m]. */
  cgOffset: number;
  /** Error in the controller's moments of inertia, standard deviation as a fraction. */
  inertiaError: number;
  /** Thruster valve response time constant [s]. */
  valveLag: number;
  /** Smallest steady valve opening, as a fraction of the thruster rating; less is pulsed. */
  minOpening: number;
  /** Controller update rate [Hz]. */
  controlRate: number;
  /** Position-tracking bandwidth [rad/s]. */
  posBandwidth: number;
  /** Attitude-tracking bandwidth [rad/s]. */
  attBandwidth: number;
  /** Random seed for the disturbances. */
  seed: number;
}

export const DEFAULT_PARAMS: Params = {
  mass: 2000,
  length: 4.3,
  width: 2.0,
  height: 1.2,
  cgHeight: 0.5,
  inertiaScale: 0.8,

  isp: 70,
  // The busiest lift thruster peaks at ≈17.5 kN in the ideal flight (the launch burn, and
  // the landing burn while one side fires harder to correct the roll overshoot); the
  // rating leaves margin for the closed-loop flight's corrections.
  liftThrusterMax: 32_000,
  // The front side thrusters only take the small sideways forces; they can't do much
  // more without yawing the car, since nothing else can cancel their yaw torque.
  rcsThrusterMax: 25_000,
  tankPressure: 30e6,
  usableFraction: 0.85,
  copvPerformance: 2.5e5,

  // One run, filmed by four cameras. Synchronized on the roll, which every view shows
  // (end-on, side-wide and side-close via the tail-light bar, front by eye): the same
  // roll angles occur at the same times since liftoff in all four to within ±0.04 s.
  // On that common clock (liftoff = 0 = the start of the launch burn, 0:19.00 in the
  // side-wide view, where the body starts to rise; the wheels leave the ground ≈0.15 s
  // later, once the suspension has extended):
  //  - launch: the side-wide rise, measured frame by frame, fits ≈3.5–3.7 g of thrust for
  //    ≈0.4 s. That camera sees the car recede as it flies toward the line-up (its apparent
  //    length falls ≈20% by 0.7 s), so each frame is scaled by the car's own length, with
  //    perspective from a ≈0.9 m camera height. Measured: ≈11 m/s upward and ≈5.8 m by
  //    0.69 s. The front view, whose camera is solved, shows the early climb directly by
  //    the car's roof line while it is still upright (0.3–0.7 s): 2.6 m at 0.3 s, then
  //    already slowing (≈5.2 m at 0.7 s). The launch burn, apex height and the front view's
  //    liftoff (one frame earlier, 0:12.81) were fitted to both views' early heights and
  //    the front view's later track together: 3.9 g for 0.32 s (solved from the apex), rms
  //    0.36 m overall, 0.15 m against the side-wide rise to 0.6 s. The front view's early
  //    heights are still ≈0.3–0.5 m above the fit, and the side-wide rise's last frames
  //    (still speeding up at 0.69 s) up to ≈0.9 m; the fitted flight reaches 7.7 m/s and
  //    4.9 m at 0.69 s;
  //  - touchdown ≈3.0 s, at ≈2.5 m/s. In the side-wide view the car is still airborne,
  //    descending, at 0:21.98 (2.98 s): its tail-light bar keeps dropping against the
  //    stage strip, slowing from ≈7 m/s at 2.7 s, while the landing-burn jets bury the
  //    wheels in smoke from ≈2.8 s (that smoke is not the touchdown). The end-on view
  //    agrees: ≈7 m up at 2.0 s, level with the Semi's top at 2.5 s, tire smoke at 3.0 s;
  //  - roll toward the noses, fitted to all views at once (rms 6.9°; end-on 1.9°): starts
  //    ≈0.52 s, ≈217°/s through the middle, stops ≈6° past level at 2.46 s and is
  //    corrected back to level by 2.60 s;
  //  - lift jets lit throughout: ≈0.3 g sustained between the burns (which also produces
  //    the ≈2 m sideways drift as it turns with the roll);
  //  - apex ≈8.5 m at ≈1.5 s (≈8.3 m in the front view's per-frame track, ≈9 m against
  //    the Semi in the side-wide view); ≈7.0 m at 2.0 s, as the front view shows. The
  //    front view's track fits to ≈0.4 m rms up to 2.2 s; after that the car runs off the
  //    left edge of the front view and its clipped outline no longer tracks it;
  //  - ground speed ≈12.4 m/s: range and apex position fitted to the front view's static,
  //    solved camera by the car's trailing edge every 0.05 s from 0.5 to 2.35 s. With the
  //    earlier 34 m (≈11.3 m/s) the real car gained steadily, ≈1.2 m/s, and left the frame
  //    early (0:15.17); now the gap is ≈0.02 m on average, rms 0.33 m. A steady speed fits
  //    as well as a forward push (fitted 0.5 m/s², within the noise), so nothing pushes the
  //    car forward.
  footageSlowdown: 1,
  airTimeVideo: 3.0,
  apexHeight: 8.5,
  range: 37.5,
  apexX: 1.7,
  launchBurnVideo: 0.32,
  sustainThrustG: 0.3,
  invertedThrustG: 0,
  touchdownSpeed: 2.5,
  rollStartVideo: 0.52,
  rollDurationVideo: 1.94,
  rollRampVideo: 0.25,
  rollStopVideo: 0.26,
  rollOvershootDeg: 6,
  rollSettleVideo: 0.14,
  rollTurns: -1,

  approachDuration: 3,
  suspensionTravel: 0.12,
  brakingDecel: 6,
  driftYawDeg: 0, // brakes straight ahead after landing; no turn

  airDensity: 1.225,
  cdaFront: 0.3 * 1.9,
  cdaTop: 1.0 * 7.5,
  cdaSide: 0.9 * 4.4,

  // Plausible imperfections for a first flight: a few percent of thrust error per
  // thruster, a CG a few centimeters off, light gusts, and on/off-style cold-gas valves.
  gustStd: 1.5,
  thrustScatter: 0.04,
  thrustNoise: 0.05,
  cgOffset: 0.03,
  inertiaError: 0.1,
  valveLag: 0.03,
  minOpening: 0.08,
  controlRate: 100,
  posBandwidth: 2.5,
  attBandwidth: 10,
  seed: 1,
};

export const G0 = 9.80665;
/** Molar mass of N₂ [kg/mol]. */
export const N2_MOLAR_MASS = 0.028013;
export const GAS_CONSTANT = 8.314462;
/** Compressibility of N₂ near 300 bar, 293 K (real-gas correction). */
export const N2_COMPRESSIBILITY = 1.1;
export const TANK_TEMPERATURE = 293;
