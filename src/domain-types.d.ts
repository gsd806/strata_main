import type {IncomingMessage,OutgoingHttpHeaders,ServerResponse} from "node:http";

export type HttpRequest = IncomingMessage;
export type HttpResponse = ServerResponse<IncomingMessage>;
export type HttpHeaders = OutgoingHttpHeaders;
export type JsonObject = Record<string,unknown>;
export type FetchLike = typeof globalThis.fetch;

export interface PaymentPrice {
  amount:string;
  currency:string;
}

export interface PaymentConfig {
  readonly environment:"live"|"sandbox";
  readonly productId:string;
  readonly priceId:string;
  readonly clientToken:string;
  readonly price:PaymentPrice;
  readonly requestedEnabled:boolean;
  readonly configured:boolean;
  readonly enabled:boolean;
  readonly missing:string[];
}

export interface PublicPaymentConfig {
  environment:"live"|"sandbox";
  enabled:boolean;
  configured:boolean;
  productId:string;
  priceId:string;
  clientToken:string;
  price:PaymentPrice;
}

export interface PaddleSecrets {
  apiKey:string;
  webhookSecret:string;
  apiBase:string;
}

export interface PaddlePriceData {
  id?:unknown;
  product_id?:unknown;
  billing_cycle?:unknown;
}

export interface PaddleItemData {
  quantity?:unknown;
  price?:PaddlePriceData|null;
}

export interface PaddleCustomData {
  strata_user_id?:unknown;
  strata_checkout_id?:unknown;
  strata_version?:unknown;
}

export interface PaddleTransactionData {
  id?:unknown;
  status?:unknown;
  origin?:unknown;
  subscription_id?:unknown;
  collection_mode?:unknown;
  custom_data?:PaddleCustomData|null;
  items?:PaddleItemData[]|unknown;
  created_at?:unknown;
}

export interface PaddleAdjustmentData {
  status?:unknown;
  type?:unknown;
  action?:unknown;
  transaction_id?:unknown;
}

export interface CheckoutIdentity {
  userId?:unknown;
  checkoutId?:unknown;
  priceId?:unknown;
  productId?:unknown;
}

export interface CheckoutRecoveryIdentity extends CheckoutIdentity {
  createdAt?:unknown;
}

export type ValidationResult={ok:true}|{ok:false;reason:string};
export interface PaddleTransactionResult {
  transactionId:string;
  status:string;
  data?:PaddleTransactionData;
}

export type StoreMethod=(...args:any[])=>any;
export type StoreMethods=Record<string,StoreMethod>;

export type AsyncStoreMethod=(...args:any[])=>Promise<any>;
export type StoreCapabilities<Names extends string>=Record<Names,AsyncStoreMethod>;

export type AuthStoreMethod=
  |"accountActionByTokenHash"|"activateAccountAction"|"adminPrincipal"|"cancelAccountDeletion"
  |"claimAccountActionSend"|"claimVerificationAttempt"|"claimVerificationSend"
  |"completeLoginVerification"|"completePasswordReset"|"completeSignup"|"consumeVerification"
  |"countVerificationSends"|"deleteAccount"|"deleteOldAccountActionData"|"deleteOldVerificationData"
  |"deleteSession"|"discardStagedAccountAction"|"insertSession"|"insertUser"|"insertVerification"
  |"markVerificationDelivery"|"rotateVerification"|"session"|"stageAccountAction"|"userByEmail"
  |"userById"|"verificationByTokenHash"|"verificationSendByChallengeGeneration";

export type AdminStoreMethod=
  |"accountCredentialsById"|"adminAudit"|"adminElevation"|"adminOverview"|"adminPrincipal"
  |"adminUserById"|"adminUsers"|"cancelAccountDeletionWithAudit"|"claimAdminPrincipal"
  |"deleteExpiredAdminElevations"|"recordAdminAudit"|"restoreUser"|"revokeUserSessions"
  |"rotateAdminSessionForElevation"|"suspendUser"|"userByEmail"|"userById";

export type SupportStoreMethod=
  |"adminSupportTickets"|"claimSupportRequestEvent"|"deleteOldSupportRequestEvents"
  |"insertSupportTicket"|"markSupportResponseSent"|"supportTicketById"|"updateSupportTicket";

export type AuthStore=StoreCapabilities<AuthStoreMethod>;
export type AdminStore={readonly kind:string}&StoreCapabilities<AdminStoreMethod>;
export type SupportStore=StoreCapabilities<SupportStoreMethod>;
export type ApplicationStore={readonly kind:string}&AuthStore&AdminStore&SupportStore;

export interface AccountIdentityRow extends JsonObject {
  id:string;
  name:string;
  email:string;
  created_at:number;
  email_verified_at:number|null;
  auth_version:number;
  suspended_at:number|null;
}

export interface UserRow extends AccountIdentityRow {
  password_hash?:string;
  password_salt?:string;
}

export interface CredentialUserRow extends JsonObject {
  password_hash:string;
  password_salt:string;
}

export interface SessionRow extends AccountIdentityRow {
  token_hash:string;
  csrf_token:string;
  expires_at:number;
}

export interface PreparedSession {
  token:string;
  csrfToken:string;
  record:{
    tokenHash:string;
    userId:string;
    csrfToken:string;
    expiresAt:number;
    createdAt:number;
    authVersion:number;
  };
}

export interface EmailConfig {
  readonly requestedEnabled:boolean;
  readonly flagValid:boolean;
  readonly configured:boolean;
  readonly deliveryConfigured:boolean;
  readonly secretConfigured:boolean;
  readonly enabled:boolean;
  readonly from:string;
  readonly replyTo:string;
  readonly supportEmail:string;
  readonly appBaseUrl:string;
  readonly missing:readonly string[];
}

export interface HttpHelpers {
  json(response:HttpResponse,status:number,data:unknown,headers?:HttpHeaders):void;
  bodyJson(request:HttpRequest):Promise<unknown>;
  bodyForm(request:HttpRequest):Promise<Record<string,string>>;
  redirect(response:HttpResponse,location:string,headers?:HttpHeaders):void;
}

export type JsonHttpHelpers=Pick<HttpHelpers,"json"|"bodyJson">;
export type AccountActionPurpose="password_reset"|"account_delete";
export interface AccountActionDelivery {expiresAt:number;maskedEmail:string;}

export interface AuthServiceDependencies {
  store:AuthStore;
  emailConfig:EmailConfig;
  environment?:NodeJS.ProcessEnv;
  exerciseIds?:Set<string>;
  isUniqueViolation?:(error:unknown)=>boolean;
  trustedAuthOrigin:(request:HttpRequest)=>boolean;
  rateAllowed:(request:HttpRequest,key:string,limit:number,windowMs?:number)=>boolean;
  http:HttpHelpers;
  getUserPayload:(account:AccountIdentityRow)=>Promise<unknown>;
  claimAdminForLogin?:(user:UserRow)=>Promise<UserRow>;
  reconcileCheckoutCreationBeforeDeletion?:(userId:string)=>Promise<number>;
  reconcileUnsettledPurchases?:(userId:string)=>Promise<number>;
  logger?:Pick<Console,"info"|"error">;
}

export interface AuthService {
  handleApi(request:HttpRequest,response:HttpResponse,url:URL):Promise<boolean>;
  handleForm(request:HttpRequest,response:HttpResponse,url:URL):Promise<void>;
  cleanup(now?:number):Promise<void>;
  sessionFor(request:HttpRequest):Promise<SessionRow|null>;
  requireSession(request:HttpRequest,response:HttpResponse):Promise<SessionRow|null>;
  sessionCookie(token:string,maxAge?:number):string;
  signupCookie(token:string,maxAge?:number):string;
  prepareSession(userId:string,now?:number,authVersion?:number):PreparedSession;
  passwordMatches(password:string,user:CredentialUserRow):Promise<boolean>;
  validCsrf(request:HttpRequest,session:SessionRow):boolean;
  requestSignedInAccountAction(account:AccountIdentityRow,purpose:AccountActionPurpose):Promise<AccountActionDelivery>;
  accountActionError(message:string,status:number,code:string):Error&{status:number;code:string};
  normalizeEmail(value:unknown):string;
  hashToken(token:string):string;
  [method:string]:unknown;
}

export interface AdminServiceDependencies {
  store:AdminStore;
  adminEmail:string;
  auth:AuthService;
  emailConfig:Pick<EmailConfig,"enabled">;
  paymentConfig:Pick<PaymentConfig,"enabled">;
  trustedAuthOrigin:(request:HttpRequest)=>boolean;
  rateAllowed:(request:HttpRequest,key:string,limit:number,windowMs?:number)=>boolean;
  http:JsonHttpHelpers;
  environment?:NodeJS.ProcessEnv;
  enforcePaddleIps?:boolean;
}

export interface AdminService {
  handleApi(request:HttpRequest,response:HttpResponse,url:URL):Promise<boolean>;
  bootstrap():Promise<void>;
  cleanup(now?:number):Promise<void>;
  adminIdentity(session:AccountIdentityRow,options?:{allowBootstrap?:boolean}):Promise<{active:boolean;boundNow:boolean;principal:JsonObject|null}>;
  maybeClaimAdminForLogin(user:UserRow):Promise<UserRow>;
  requireAdmin(request:HttpRequest,response:HttpResponse,options?:{elevated?:boolean;allowBootstrap?:boolean}):Promise<SessionRow|null>;
  requireAdminMutation(request:HttpRequest,response:HttpResponse,session:SessionRow):boolean;
  sensitiveAdminText(value:unknown):boolean;
  cleanAdminTarget(value:unknown):string;
  adminAuditEvent(actorUserId:string,targetUserId:string|null,action:string,reason:string,result?:string):JsonObject;
  recordAdminAudit(actorUserId:string,targetUserId:string|null,action:string,reason:string,result?:string):Promise<void>;
  [method:string]:unknown;
}

export interface SupportServiceDependencies {
  store:SupportStore;
  emailConfig:EmailConfig;
  auth:AuthService;
  admin:AdminService;
  requestAddress:(request:HttpRequest)=>string;
  trustedAuthOrigin:(request:HttpRequest)=>boolean;
  rateAllowed:(request:HttpRequest,key:string,limit:number,windowMs?:number)=>boolean;
  isUniqueViolation?:(error:unknown)=>boolean;
  http:JsonHttpHelpers;
  logger?:Pick<Console,"error">;
}

export interface SupportService {
  handleApi(request:HttpRequest,response:HttpResponse,url:URL):Promise<boolean>;
  cleanup(now?:number):Promise<void>;
  supportTicketPayload(row:JsonObject):JsonObject;
}

export type CreateAuthService=(dependencies:AuthServiceDependencies)=>AuthService;
export type CreateAdminService=(dependencies:AdminServiceDependencies)=>AdminService;
export type CreateSupportService=(dependencies:SupportServiceDependencies)=>SupportService;

export interface ServiceCompositionDependencies {
  store:ApplicationStore;
  emailConfig:EmailConfig;
  paymentConfig:PaymentConfig;
  adminEmail:string;
  enforcePaddleIps:boolean;
  exerciseIds:Set<string>;
  trustedAuthOrigin:(request:HttpRequest)=>boolean;
  rateAllowed:(request:HttpRequest,key:string,limit:number,windowMs?:number)=>boolean;
  requestAddress:(request:HttpRequest)=>string;
  http:HttpHelpers;
  getUserPayload:(account:AccountIdentityRow)=>Promise<unknown>;
  reconcileCheckoutCreationBeforeDeletion:(userId:string)=>Promise<number>;
  reconcileUnsettledPurchases:(userId:string)=>Promise<number>;
  isUniqueViolation:(error:unknown)=>boolean;
  createAuthService:CreateAuthService;
  createAdminService:CreateAdminService;
  createSupportService:CreateSupportService;
}
