import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';

const rawBody=JSON.stringify({
  event:'OPENPIX:TRANSACTION_RECEIVED',
  pix:{
    value:200,
    time:'2026-10-07T20:10:56.000Z',
    endToEndId:'E18236120202610072010s56149dd987',
    status:'CONFIRMED',
    type:'PAYMENT'
  },
  company:{id:'company-test'}
});

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const signature=sign('RSA-SHA256',Buffer.from(rawBody),privateKey);

const spki=publicKey.export({type:'spki',format:'der'});
const imported=await webcrypto.subtle.importKey(
  'spki',
  spki,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},
  false,
  ['verify']
);

assert.equal(
  await webcrypto.subtle.verify(
    {name:'RSASSA-PKCS1-v1_5'},
    imported,
    signature,
    new TextEncoder().encode(rawBody)
  ),
  true,
  'RSA-SHA256 precisa validar o corpo bruto intacto'
);

assert.equal(
  await webcrypto.subtle.verify(
    {name:'RSASSA-PKCS1-v1_5'},
    imported,
    signature,
    new TextEncoder().encode(rawBody+' ')
  ),
  false,
  'qualquer alteração no corpo bruto precisa invalidar a assinatura'
);

const signatureBase64=signature.toString('base64');
const decoded=Buffer.from(signatureBase64,'base64');
assert.deepEqual(decoded,signature,'assinatura Base64 precisa preservar os bytes RSA');

console.log('Woovi webhook crypto contract passou.');
