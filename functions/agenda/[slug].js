import {nativePageRoute} from '../_shared/native-route.js';
// The active Agenda and its illustrative /agenda/exemplo/ remain static.
export function onRequest(context){return nativePageRoute(context,'agenda');}
