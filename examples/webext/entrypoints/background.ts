import { defineBackground } from 'wxt/utils/define-background';
import { startExampleBackground } from '../src/background';

export default defineBackground({ type: 'module', main: startExampleBackground });
