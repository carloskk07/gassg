import {nativePageRoute} from '../_shared/native-route.js';
// Cloudflare Pages routes single dynamic segments, with or without slash.
export function onRequest(context){return nativePageRoute(context,'p');}
