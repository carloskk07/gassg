if((globalThis.CHAMA_PORTAL_ROLE===''||globalThis.CHAMA_PORTAL_ROLE==='customer')&&new URLSearchParams(location.search).get('agenda')==='1')location.replace('/agenda/'+location.search+location.hash);
