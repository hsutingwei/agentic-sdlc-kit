// asdk enable   and   asdk disable [--reason <text>]

import { parse } from '../../core/cli.mjs';
import { disableRecording, enableRecording } from '../lib/recording.mjs';

export async function runDisable(argv, { env, out }) {
  const { values } = parse(argv, { reason: { type: 'string' } }, { usage: 'asdk disable [--reason <text>]' });
  out(disableRecording(env, { reason: values.reason }) ? 'recording disabled; hooks stay installed and record nothing until `asdk enable`' : 'recording was already disabled');
  return 0;
}

export async function runEnable(argv, { env, out }) {
  parse(argv, {}, { usage: 'asdk enable' });
  out(enableRecording(env) ? 'recording enabled' : 'recording was already enabled');
  return 0;
}
