import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { recordScriptTiming } from '../src/script-timing';

export default defineUnlistedScript(recordScriptTiming);
