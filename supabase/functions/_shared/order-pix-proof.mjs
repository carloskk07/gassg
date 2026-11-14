import {validatePixBrCode} from './pix-brcode.js';
import {moneyToCents,mercadoPagoPixDeadline} from './mercadopago.js';

export function verifiedOrderPix(order,{reference,sellerId,amountCents,createdAt,orderId=null}){
 const payments=order?.transactions?.payments;
 if(!order||order.live_mode===false||order.external_reference!==reference||
   String(order.user_id??'')!==sellerId||moneyToCents(order.total_amount)!==amountCents||
   !/^[A-Za-z0-9_-]{6,240}$/.test(String(order.id||''))||orderId&&order.id!==orderId||
   !Array.isArray(payments)||payments.length!==1)return null;
 const payment=payments[0],method=payment?.payment_method;
 if(method?.id!=='pix'||method?.type!=='bank_transfer'||moneyToCents(payment.amount)!==amountCents||
   !['created','pending','action_required'].includes(String(payment.status||order.status||''))||
   ['processed','cancelled','refunded','failed','charged_back'].includes(String(order.status||''))||
   !validatePixBrCode(method.qr_code,{expectedAmountCents:amountCents}).valid)return null;
 const expiresAt=mercadoPagoPixDeadline(order,payment,createdAt);
 if(!expiresAt)return null;
 return {orderId:String(order.id),pixCode:method.qr_code,expiresAt,amountCents,pixPayable:true};
}
