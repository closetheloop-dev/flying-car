import { fmt, num } from './units';

export const formatForce = (n: number): string => fmt('force', n);
export const formatTorque = (nm: number): string => fmt('torque', nm);
export const formatPower = (w: number): string => fmt('power', w);
export const formatNum = (v: number, digits = 1): string => num(v, digits);
export const formatTime = (t: number): string => `${t < 0 ? '−' : '+'}${num(Math.abs(t), 2)} s`;
export const deg = (rad: number): number => (rad * 180) / Math.PI;
