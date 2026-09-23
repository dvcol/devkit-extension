import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContent } from '../../../shared/content';
export default defineContentScript({ matches: ['http://127.0.0.1/*'], main(context) { context.onInvalidated(startContent()); } });
