--
-- PostgreSQL database dump
--

\restrict gJVzWlKWlf3ssovBcP5UIGtx5j7hY6Vy6vuEnwKUhhNa9WicAiUbPdbQ4pWJHoK

-- Dumped from database version 18.1 (Debian 18.1-1.pgdg12+2)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: appfbo_db_user
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO appfbo_db_user;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: appfbo_db_user
--

COMMENT ON SCHEMA public IS '';


--
-- Name: AdminRole; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."AdminRole" AS ENUM (
    'SUPER_ADMIN',
    'TECH_ADMIN',
    'OPERATIONS_DIRECTOR',
    'SALES_DIRECTOR',
    'BILLING_MANAGER',
    'MARKETING_ASSISTANT',
    'STOCK_MANAGER',
    'COUNTER_MANAGER',
    'INVOICER',
    'ORDER_PREPARER'
);


ALTER TYPE public."AdminRole" OWNER TO appfbo_db_user;

--
-- Name: DeliveryMode; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."DeliveryMode" AS ENUM (
    'RETRAIT_SITE_FLP',
    'LIVRAISON'
);


ALTER TYPE public."DeliveryMode" OWNER TO appfbo_db_user;

--
-- Name: Grade; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."Grade" AS ENUM (
    'ANIMATEUR_ADJOINT',
    'ANIMATEUR',
    'MANAGER_ADJOINT',
    'MANAGER',
    'CLIENT_PRIVILEGIE'
);


ALTER TYPE public."Grade" OWNER TO appfbo_db_user;

--
-- Name: OrderMessageChannel; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."OrderMessageChannel" AS ENUM (
    'WHATSAPP'
);


ALTER TYPE public."OrderMessageChannel" OWNER TO appfbo_db_user;

--
-- Name: OrderMessagePurpose; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."OrderMessagePurpose" AS ENUM (
    'INVOICE',
    'PAYMENT_LINK',
    'REMINDER',
    'PAYMENT_CONFIRMED',
    'ORDER_READY'
);


ALTER TYPE public."OrderMessagePurpose" OWNER TO appfbo_db_user;

--
-- Name: OrderMessageStatus; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."OrderMessageStatus" AS ENUM (
    'DRAFT',
    'QUEUED',
    'SENT',
    'DELIVERED',
    'READ',
    'FAILED',
    'CANCELLED'
);


ALTER TYPE public."OrderMessageStatus" OWNER TO appfbo_db_user;

--
-- Name: PaymentMode; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."PaymentMode" AS ENUM (
    'WAVE',
    'ORANGE_MONEY',
    'ESPECES',
    'OTHER'
);


ALTER TYPE public."PaymentMode" OWNER TO appfbo_db_user;

--
-- Name: PreorderLogAction; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."PreorderLogAction" AS ENUM (
    'CREATE_DRAFT',
    'SET_ITEMS',
    'REPRICE',
    'SUBMIT',
    'INVOICE',
    'RECEIVE_PAYMENT_PROOF',
    'VERIFY_PAYMENT',
    'MARK_PAID',
    'PREPARE',
    'FULFILL',
    'CANCEL',
    'STOCK_DEBIT',
    'STOCK_CREDIT'
);


ALTER TYPE public."PreorderLogAction" OWNER TO appfbo_db_user;

--
-- Name: PreorderStatus; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."PreorderStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'INVOICED',
    'PAID',
    'CANCELLED',
    'PAYMENT_PROOF_RECEIVED',
    'READY',
    'FULFILLED'
);


ALTER TYPE public."PreorderStatus" OWNER TO appfbo_db_user;

--
-- Name: ProductCategory; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."ProductCategory" AS ENUM (
    'NON_CLASSE',
    'BUVABLE',
    'COMBO_PACKS',
    'GESTION_DE_POIDS',
    'NUTRITION',
    'PRODUIT_DE_LA_RUCHE',
    'SOINS_DE_LA_PEAU',
    'SOINS_PERSONNELS'
);


ALTER TYPE public."ProductCategory" OWNER TO appfbo_db_user;

--
-- Name: StockMovementReason; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."StockMovementReason" AS ENUM (
    'PREPARE_ORDER',
    'CANCEL_ORDER',
    'MANUAL_ADJUSTMENT'
);


ALTER TYPE public."StockMovementReason" OWNER TO appfbo_db_user;

--
-- Name: StockMovementType; Type: TYPE; Schema: public; Owner: appfbo_db_user
--

CREATE TYPE public."StockMovementType" AS ENUM (
    'DEBIT',
    'CREDIT'
);


ALTER TYPE public."StockMovementType" OWNER TO appfbo_db_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdminUser; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."AdminUser" (
    id text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    "fullName" text,
    role public."AdminRole" NOT NULL,
    actif boolean DEFAULT true NOT NULL,
    "countryId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AdminUser" OWNER TO appfbo_db_user;

--
-- Name: Country; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."Country" (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    "currencyCode" text,
    actif boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Country" OWNER TO appfbo_db_user;

--
-- Name: CountrySettings; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."CountrySettings" (
    id text NOT NULL,
    "countryId" text NOT NULL,
    "minCartFcfa" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CountrySettings" OWNER TO appfbo_db_user;

--
-- Name: Fbo; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."Fbo" (
    id text NOT NULL,
    "numeroFbo" text NOT NULL,
    "nomComplet" text NOT NULL,
    grade public."Grade" NOT NULL,
    "pointDeVente" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Fbo" OWNER TO appfbo_db_user;

--
-- Name: FboCountry; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."FboCountry" (
    id text NOT NULL,
    "fboId" text NOT NULL,
    "countryId" text NOT NULL,
    "pointDeVente" text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."FboCountry" OWNER TO appfbo_db_user;

--
-- Name: GradeDiscount; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."GradeDiscount" (
    id text NOT NULL,
    grade public."Grade" NOT NULL,
    "discountPercent" numeric(5,2) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "countryId" text NOT NULL
);


ALTER TABLE public."GradeDiscount" OWNER TO appfbo_db_user;

--
-- Name: OrderMessage; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."OrderMessage" (
    id text NOT NULL,
    "preorderId" text NOT NULL,
    channel public."OrderMessageChannel" DEFAULT 'WHATSAPP'::public."OrderMessageChannel" NOT NULL,
    purpose public."OrderMessagePurpose" NOT NULL,
    status public."OrderMessageStatus" DEFAULT 'DRAFT'::public."OrderMessageStatus" NOT NULL,
    "toPhone" text,
    body text,
    provider text,
    "providerMessageId" text,
    "paymentLinkTracked" text,
    "paymentLinkTarget" text,
    "sentAt" timestamp(3) without time zone,
    "deliveredAt" timestamp(3) without time zone,
    "readAt" timestamp(3) without time zone,
    "failedAt" timestamp(3) without time zone,
    "lastStatusAt" timestamp(3) without time zone,
    "errorCode" text,
    "errorMessage" text,
    "createdBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."OrderMessage" OWNER TO appfbo_db_user;

--
-- Name: OrderMessageEvent; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."OrderMessageEvent" (
    id text NOT NULL,
    "orderMessageId" text NOT NULL,
    status text NOT NULL,
    "rawPayload" jsonb,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."OrderMessageEvent" OWNER TO appfbo_db_user;

--
-- Name: Preorder; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."Preorder" (
    id text NOT NULL,
    status public."PreorderStatus" DEFAULT 'DRAFT'::public."PreorderStatus" NOT NULL,
    "fboId" text NOT NULL,
    "fboNumero" text NOT NULL,
    "fboNomComplet" text NOT NULL,
    "fboGrade" public."Grade" NOT NULL,
    "pointDeVente" text NOT NULL,
    "paymentMode" public."PaymentMode",
    "deliveryMode" public."DeliveryMode",
    "totalCc" numeric(12,3) DEFAULT 0.000 NOT NULL,
    "totalPoidsKg" numeric(12,3) DEFAULT 0.000 NOT NULL,
    "totalProduitsFcfa" integer DEFAULT 0 NOT NULL,
    "fraisLivraisonFcfa" integer DEFAULT 0 NOT NULL,
    "totalFcfa" integer DEFAULT 0 NOT NULL,
    "whatsappMessage" text,
    "factureReference" text,
    "factureWhatsappTo" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "submittedAt" timestamp(3) without time zone,
    "paidAt" timestamp(3) without time zone,
    "cancelReason" text,
    "cancelledAt" timestamp(3) without time zone,
    "cancelledBy" text,
    "deliveryTracking" text,
    "fulfilledAt" timestamp(3) without time zone,
    "fulfilledBy" text,
    "internalNote" text,
    "invoicedAt" timestamp(3) without time zone,
    "invoicedBy" text,
    "packingNote" text,
    "paymentLink" text,
    "paymentProofNote" text,
    "paymentProofUrl" text,
    "paymentRef" text,
    "paymentVerifiedBy" text,
    "preparedAt" timestamp(3) without time zone,
    "preparedBy" text,
    "proofReceivedAt" timestamp(3) without time zone,
    "proofReceivedBy" text,
    "countryId" text NOT NULL,
    "cancelledById" text,
    "fulfilledById" text,
    "invoicedById" text,
    "paymentVerifiedById" text,
    "preparedById" text,
    "proofReceivedById" text,
    "paymentVerifiedAt" timestamp(3) without time zone,
    "stockDeductedAt" timestamp(3) without time zone,
    "stockRestoredAt" timestamp(3) without time zone,
    "lastWhatsappMessageId" text,
    "lastWhatsappStatus" text,
    "lastWhatsappStatusAt" timestamp(3) without time zone,
    "paymentLinkClickCount" integer DEFAULT 0 NOT NULL,
    "paymentLinkClickedAt" timestamp(3) without time zone
);


ALTER TABLE public."Preorder" OWNER TO appfbo_db_user;

--
-- Name: PreorderItem; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."PreorderItem" (
    id text NOT NULL,
    "preorderId" text NOT NULL,
    "productId" text NOT NULL,
    qty integer DEFAULT 1 NOT NULL,
    "prixUnitaireFcfa" integer NOT NULL,
    "ccUnitaire" numeric(10,3) NOT NULL,
    "poidsUnitaireKg" numeric(10,3) NOT NULL,
    "lineTotalFcfa" integer NOT NULL,
    "lineTotalCc" numeric(12,3) NOT NULL,
    "lineTotalPoids" numeric(12,3) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "discountPercent" numeric(5,2) DEFAULT 0.00 NOT NULL,
    "prixCatalogueFcfa" integer NOT NULL,
    "productNameSnapshot" text,
    "productSkuSnapshot" text
);


ALTER TABLE public."PreorderItem" OWNER TO appfbo_db_user;

--
-- Name: PreorderLog; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."PreorderLog" (
    id text NOT NULL,
    "preorderId" text NOT NULL,
    note text,
    meta jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    action public."PreorderLogAction" NOT NULL
);


ALTER TABLE public."PreorderLog" OWNER TO appfbo_db_user;

--
-- Name: Product; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."Product" (
    id text NOT NULL,
    sku text NOT NULL,
    nom text NOT NULL,
    "imageUrl" text,
    "prixBaseFcfa" integer NOT NULL,
    cc numeric(10,3) NOT NULL,
    "poidsKg" numeric(10,3) NOT NULL,
    actif boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    category public."ProductCategory" DEFAULT 'NON_CLASSE'::public."ProductCategory" NOT NULL,
    details text,
    "stockQty" integer DEFAULT 0 NOT NULL,
    "countryId" text NOT NULL
);


ALTER TABLE public."Product" OWNER TO appfbo_db_user;

--
-- Name: StockMovement; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public."StockMovement" (
    id text NOT NULL,
    "productId" text NOT NULL,
    "preorderId" text,
    type public."StockMovementType" NOT NULL,
    reason public."StockMovementReason" NOT NULL,
    qty integer NOT NULL,
    note text,
    meta jsonb,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StockMovement" OWNER TO appfbo_db_user;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: appfbo_db_user
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO appfbo_db_user;

--
-- Data for Name: AdminUser; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."AdminUser" (id, email, password, "fullName", role, actif, "countryId", "createdAt", "updatedAt") FROM stdin;
cmmc6gfhs00014nxc479niy5h	admin@forever.ci	$2b$10$1v.c1pBT6ljB/X.CaH2V8uvKllTMYPLNLz.Uycd/BsoEU7NH2sIpS	Super Admin	SUPER_ADMIN	t	\N	2026-03-04 15:14:19.881	2026-03-04 15:14:19.881
cmmlvsire0001f7s7axfdhb2t	agoussi@forever.ci	$2b$10$asaL6AX78RQNFbr6yE2WseMr4Sezwgl2UYG9G.ZuN5PGqk63sXEge	AGOUSSI FABRICE	INVOICER	t	country_ci_default	2026-03-11 10:13:29.978	2026-03-11 10:13:29.978
cmmlwl4m7000114mmh9ktbzx5	akoudje@gmail.com	$2b$10$c9G.2eqmQ5R3.pWQ9P4gFOu/TuV6tHYwJjcWk9IrsTgs3e3ynMwTO	AKOUDJE JUNIOR	SUPER_ADMIN	t	country_ci_default	2026-03-11 10:35:44.672	2026-03-11 10:35:44.672
cmmm3fgvq0001137qn3uvle11	nanacarole@forever.ci	$2b$10$PHsr5CKMwKgwo6iE6oMQJOpcTdII1kHec/glwwr9dwYvm8Q5wtyia	Carole NANA	INVOICER	t	country_ci_default	2026-03-11 13:47:17.943	2026-03-11 14:53:50.683
\.


--
-- Data for Name: Country; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."Country" (id, code, name, "currencyCode", actif, "createdAt", "updatedAt") FROM stdin;
country_ci_default	CIV	Cote d'Ivoire	XOF	t	2026-03-06 11:26:05.109	2026-03-12 21:42:00.155
cmmet7i4o0005zu1u2l587yvo	BFA	Burkina Faso	XOF	t	2026-03-06 11:26:46.92	2026-03-12 21:42:00.265
cmmet7itg000azu1ul2rrzr0i	TGO	Togo	XOF	t	2026-03-06 11:26:47.813	2026-03-12 21:42:00.361
cmmet7jjr000fzu1u0qabmha1	BEN	Benin	XOF	t	2026-03-06 11:26:48.759	2026-03-12 21:42:00.462
cmmet7ka5000kzu1u17js0tjx	NER	Niger	XOF	t	2026-03-06 11:26:49.709	2026-03-12 21:42:00.552
cmmjcsh6h0000beh1qkkqeruu	CI	Cote d'Ivoire	XOF	t	2026-03-09 15:46:02.873	2026-03-10 12:49:23.134
cmmjcsh8m0005beh1guy9un9y	BF	Burkina Faso	XOF	t	2026-03-09 15:46:02.95	2026-03-10 12:49:23.154
cmmjcsh8w000abeh1i8qsufkx	TG	Togo	XOF	t	2026-03-09 15:46:02.96	2026-03-10 12:49:23.214
cmmjcsh96000fbeh13dy2my8i	BJ	Benin	XOF	t	2026-03-09 15:46:02.971	2026-03-10 12:49:23.228
cmmjcsh9h000kbeh11v3s4pdx	NE	Niger	XOF	t	2026-03-09 15:46:02.981	2026-03-10 12:49:23.238
\.


--
-- Data for Name: CountrySettings; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."CountrySettings" (id, "countryId", "minCartFcfa", "createdAt", "updatedAt") FROM stdin;
cmmjcsh6o0002beh1pfs7tszr	cmmjcsh6h0000beh1qkkqeruu	10000	2026-03-09 15:46:02.88	2026-03-10 12:49:23.141
cmmjcsh8p0007beh1jyfjkh39	cmmjcsh8m0005beh1guy9un9y	10000	2026-03-09 15:46:02.953	2026-03-10 12:49:23.207
cmmjcsh8z000cbeh1qhac5yk5	cmmjcsh8w000abeh1i8qsufkx	10000	2026-03-09 15:46:02.963	2026-03-10 12:49:23.217
cmmjcsh99000hbeh16s3p2pxq	cmmjcsh96000fbeh13dy2my8i	10000	2026-03-09 15:46:02.974	2026-03-10 12:49:23.232
cmmjcsh9j000mbeh1j9nn2anm	cmmjcsh9h000kbeh11v3s4pdx	10000	2026-03-09 15:46:02.984	2026-03-10 12:49:23.241
country_settings_ci_default	country_ci_default	10000	2026-03-06 11:26:05.109	2026-03-12 21:42:00.252
cmmet7idc0007zu1uo01x68fj	cmmet7i4o0005zu1u2l587yvo	10000	2026-03-06 11:26:47.232	2026-03-12 21:42:00.352
cmmet7j2r000czu1u3lt4q95v	cmmet7itg000azu1ul2rrzr0i	10000	2026-03-06 11:26:48.148	2026-03-12 21:42:00.451
cmmet7jvw000hzu1un8ln7j8n	cmmet7jjr000fzu1u0qabmha1	10000	2026-03-06 11:26:49.196	2026-03-12 21:42:00.465
cmmet7khy000mzu1u8e8d7ern	cmmet7ka5000kzu1u17js0tjx	10000	2026-03-06 11:26:49.99	2026-03-12 21:42:00.558
\.


--
-- Data for Name: Fbo; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."Fbo" (id, "numeroFbo", "nomComplet", grade, "pointDeVente", "createdAt", "updatedAt") FROM stdin;
cmls2s10x00016gu5xiyu96ej	225-676-766-868	KONAN CEDRIC	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-18 13:35:59.025	2026-02-18 13:35:59.025
cmls3bkd500086gu5zj8pp6q2	123-557-896-588	AKA JOEL	MANAGER	ABIDJAN	2026-02-18 13:51:10.551	2026-02-18 13:51:10.551
cmls571ll00216gu5qlm9pqr0	225-000-121-929	Amichia Jean Baptiste 	MANAGER	ABIDJAN	2026-02-18 14:43:38.826	2026-02-18 14:43:38.826
cmls57ncn002i6gu5prb0rqja	112-233-369-884	AKA Julie	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-18 14:44:07.031	2026-02-18 14:44:07.031
cmls5ygvi0000fazfe9y8jp6d	226-452-395-807	ALLA Blondeau	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-18 15:04:58.35	2026-02-18 15:04:58.35
cmls6rwem0000eq9myen2zmr2	221-959-595-944	Monnet 	MANAGER	ABIDJAN	2026-02-18 15:27:51.5	2026-02-18 15:27:51.5
cmlslaam80000ean6fz76s8pj	215-154-565-456	AKOUDJE DOGBO JEAN JUNIOR	MANAGER	ABIDJAN	2026-02-18 22:14:04.353	2026-02-18 22:14:04.353
cmlsw923u0000gc683mm4mzjy	225-000-112-233	AKOUDJE DOGBO JEAN JUNIOR	MANAGER	ABIDJAN	2026-02-19 03:21:02.44	2026-02-19 03:21:02.44
cmltd9jl10000t65wg5zhwtc7	343-311-212-121	Isaac SEMILOI	ANIMATEUR	ABIDJAN	2026-02-19 11:17:18.565	2026-02-19 11:17:18.565
cmltu1bcd0000d0hzxazml8es	343-434-554-545	Junior Akoudjé	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-19 19:06:48.107	2026-02-19 19:06:48.107
cmltu94mi0003d0hzmrtuqt9x	343-353-353-535	AKOUDJE DOGBO JEAN JUNIOR	MANAGER	ABIDJAN	2026-02-19 19:12:52.551	2026-02-19 19:12:52.551
cmltun95b000ed0hzpz7vn5zm	256-556-556-562	SEKA	MANAGER	ABIDJAN	2026-02-19 19:23:51.694	2026-02-19 19:23:51.694
cmlteikzd0000acqjdmibz8ur	225-000-370-197	AGOUSSI	MANAGER	ABIDJAN	2026-02-19 11:52:19.897	2026-02-19 19:25:20.244
cmltv0zbx008qd0hz9rj97w33	165-299-295-955	KONAN MARC	MANAGER	ABIDJAN	2026-02-19 19:34:32.115	2026-02-19 19:34:32.115
cmlu07ixi0000n6apy0f13c4v	856-974-523-599	AKOUDJE DOGBO JEAN JUNIOR	MANAGER	ABIDJAN	2026-02-19 21:59:35.575	2026-02-19 21:59:35.575
cmlu0q7j40003n6apsal2oehf	123-456-789-588	AKA JOB	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-19 22:14:07.25	2026-02-19 22:14:07.25
cmlu23ij50000d9megbpoim55	225-000-614-259	Cissé Inza	CLIENT_PRIVILEGIE	ABIDJAN	2026-02-19 22:52:27.665	2026-02-19 22:52:27.665
cmlu2pivt0017d9meiazgsefy	124-563-284-153	Celestin	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-19 23:09:34.488	2026-02-19 23:09:34.488
cmlu32xzw0021d9me8u3vxz5y	152-145-125-658	TOUSSAINT	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-19 23:20:00.621	2026-02-19 23:20:00.621
cmlu395bd002nd9me7i4xks8n	142-562-346-597	CEllestin	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-19 23:24:50.087	2026-02-19 23:24:50.087
cmlu4nvze0000qumbc1i84g5o	123-456-789-544	Azerty	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-20 00:04:17.45	2026-02-20 00:04:17.45
cmlumjrqj0000rdx2ko6yqbx3	344-100-425-009	OMER DIPAMA	MANAGER	ABIDJAN	2026-02-20 08:24:58.412	2026-02-20 08:24:58.412
cmluogf720000s5bxzvv8wzit	225-000-112-121	Isaac SEMILOI	CLIENT_PRIVILEGIE	ABIDJAN	2026-02-20 09:18:21.42	2026-02-20 09:18:21.42
cmluot0ti0020s5bxjnyf29g6	121-123-243-354	KONE ISSA	MANAGER	ABIDJAN	2026-02-20 09:28:09.317	2026-02-20 09:28:09.317
cmluq98c30000425mwrh2731b	232-323-224-434	SOROCOPI	MANAGER_ADJOINT	ABIDJAN	2026-02-20 10:08:45.171	2026-02-20 10:08:45.171
cmlurvlyc0000jwd86gsakas4	232-323-243-466	SOROCOPI	ANIMATEUR	ABIDJAN	2026-02-20 10:54:08.868	2026-02-20 10:54:08.868
cmlus8ykl000njwd8hsor05i8	125-633-998-426	AKOU Jules	ANIMATEUR	ABIDJAN	2026-02-20 11:04:31.669	2026-02-20 11:04:31.669
cmlusatoy0019jwd81vq9frm2	212-123-232-434	SOROCOPI	ANIMATEUR	ABIDJAN	2026-02-20 11:05:58.736	2026-02-20 11:05:58.736
cmluthdjc0000sjf9dp6bekhy	123-456-785-236	AKO Sylvain	MANAGER	ABIDJAN	2026-02-20 11:39:04.008	2026-02-20 11:39:04.008
cmluvof5a0000oho4r2sm3cyu	111-212-333-546	AKOUDJE DOGBO JEAN JUNIOR	ANIMATEUR	ABIDJAN	2026-02-20 12:40:31.901	2026-02-20 12:40:31.901
cmluvp8nw0003oho403rx3jsk	225-000-345-628	Simone	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-20 12:41:10.171	2026-02-20 12:41:10.171
cmluwcftw0006oho4yqv248fq	112-121-343-434	Fabrice	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-20 12:59:12.534	2026-02-20 12:59:12.534
cmluwdcus0009oho4myb82fhl	233-454-567-879	DOGBO JEAN	ANIMATEUR	ABIDJAN	2026-02-20 12:59:55.346	2026-02-20 12:59:55.346
cmluwg3yk000coho4f6a1923u	121-233-354-565	Isaac SEMILOI	MANAGER_ADJOINT	ABIDJAN	2026-02-20 13:02:03.787	2026-02-20 13:02:03.787
cmluwq29n000foho44zf1aj7o	212-121-323-234	Junior Akoudjé	ANIMATEUR	ABIDJAN	2026-02-20 13:09:48.039	2026-02-20 13:09:48.039
cmlux49ud000loho4t2lze0ga	123-456-789-000	Isaac SEMILOI	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-20 13:20:51.14	2026-02-20 13:20:51.14
cmluxth9d00001015kuq9ntvp	123-456-543-234	SOROCOPI	ANIMATEUR	ABIDJAN	2026-02-20 13:40:27.169	2026-02-20 13:40:27.169
cmluxzpz6000310150tmlmehx	234-567-654-321	AKON LOUIS	ANIMATEUR	ABIDJAN	2026-02-20 13:45:18.401	2026-02-20 13:45:18.401
cmluy4l0j00061015k169gl2f	121-232-334-435	DOGBO JEAN-JUNIOR AKOUDJE	ANIMATEUR	ABIDJAN	2026-02-20 13:49:05.155	2026-02-20 13:49:05.155
cmluykva40009101574ts5nhh	122-345-678-999	KOUKA	ANIMATEUR	ABIDJAN	2026-02-20 14:01:44.981	2026-02-20 14:01:44.981
cmlv1xynl0000z4etdgd3vnop	225-000-876-543	KOUKA	ANIMATEUR	ABIDJAN	2026-02-20 15:35:54.802	2026-02-20 15:35:54.802
cmlv1znqg0003z4et4g5dsw3e	323-233-432-122	SOROCOPI	MANAGER_ADJOINT	ABIDJAN	2026-02-20 15:37:13.958	2026-02-20 15:37:13.958
cmlv3873r0000mz79rw2nlmsw	225-000-111-334	KOUKA	ANIMATEUR	ABIDJAN	2026-02-20 16:11:51.928	2026-02-20 16:11:51.928
cmlv4167u0000f8n0yw499sm2	123-434-343-020	Isaac SEMILOI	MANAGER_ADJOINT	ABIDJAN	2026-02-20 16:34:23.8	2026-02-20 16:34:23.8
cmly3ytbr0000x9sp5jgdejdu	123-366-489-555	AKON LOUIS	ANIMATEUR	ABIDJAN	2026-02-22 18:55:52.309	2026-02-22 18:55:52.309
cmly84mv9000m873bvi0fjapz	124-546-434-349	BANCE ISSA	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-22 20:52:22.34	2026-02-22 20:52:22.34
cmly8i6y70017873b9b6e2fof	123-454-015-124	Aïcha Bance	ANIMATEUR	ABIDJAN	2026-02-22 21:02:54.894	2026-02-22 21:02:54.894
cmlyat1af0007b25gbukn0hga	538-582-827-420	BOUSSIM 	ANIMATEUR	ABIDJAN	2026-02-22 22:07:20.004	2026-02-22 22:07:20.004
cmlyaw1i7000ub25gfux3o1rj	146-563-257-896	ABBEY CHARKES	MANAGER	ABIDJAN	2026-02-22 22:09:40.254	2026-02-22 22:09:40.254
cmlybm1iz0012b25gbuj0urc8	145-236-578-889	AKOUDJE DOGBO JEAN JUNIOR	ANIMATEUR	ABIDJAN	2026-02-22 22:29:53.326	2026-02-22 22:29:53.326
cmlybs3rd001ib25gekf5etfg	123-468-989-794	KONAN MARC	ANIMATEUR	ABIDJAN	2026-02-22 22:34:36.168	2026-02-22 22:34:36.168
cmlyc4laz0020b25g9zw9mdy9	120-000-145-236	ZOUGBO	CLIENT_PRIVILEGIE	ABIDJAN	2026-02-22 22:44:18.778	2026-02-22 22:44:18.778
cmlyc7636005ub25g5bil4q0m	452-123-654-789	DOBE GNAORE	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-22 22:46:19.025	2026-02-22 22:46:19.025
cmlyvm40g0000lgcmvoetd9ax	225-000-145-256	PIERRE EMMANUEL	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-23 07:49:48.88	2026-02-23 07:49:48.88
cmlyzsig900006g67z9jlvtik	123-456-789-855	KRA Kouadio	ANIMATEUR	ABIDJAN	2026-02-23 09:46:45.991	2026-02-23 09:46:45.991
cmls6sfl60003eq9mm9ldqgpt	225-000-124-245	Monnet AMlon Julie 	ANIMATEUR	ABIDJAN	2026-02-18 15:28:16.36	2026-02-23 13:33:01.78
cmls4ruke001a6gu5ubuxcb5i	225-000-378-197	Agoussi	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-18 14:31:49.866	2026-02-23 13:49:26.414
cmm0rildx0000jq7pmti9nomn	123-456-889-665	Dogo Charles	ANIMATEUR	ABIDJAN	2026-02-24 15:30:38.66	2026-02-24 15:30:38.66
cmm20mzr30000tq72fka6rw4b	225-000-121-990	ALLA BLONDEAU SOSTHENE	MANAGER	ABIDJAN	2026-02-25 12:33:46.622	2026-02-25 12:33:46.622
cmm2qp8cm0000n36ko88dc9l7	414-258-693-666	AKA PAUL	ANIMATEUR	ABIDJAN	2026-02-26 00:43:21.093	2026-02-26 00:43:21.093
cmm37o6r700015om4ayka11um	123-455-678-889	AKOUDJE DOGBO JEAN JUNIOR	ANIMATEUR	ABIDJAN	2026-02-26 08:38:25.841	2026-02-26 08:38:25.841
cmm3qsij00000mbfqypoupejd	232-323-246-578	TOTO	ANIMATEUR	ABIDJAN	2026-02-26 17:33:40.429	2026-02-26 17:33:40.429
cmm4k8ivp0000pc46o3fj0tpj	122-547-774-265	KOFFI KOUASSI	ANIMATEUR	ABIDJAN	2026-02-27 07:17:56.246	2026-02-27 07:17:56.246
cmm4kgm8u0012pc46p8kciogm	254-125-563-998	AKA Paul	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-27 07:24:13.767	2026-02-27 07:24:13.767
cmls39rem00056gu5ytpf9wer	121-212-121-212	KONE ISSA	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-18 13:49:46.35	2026-02-27 09:25:14.865
cmm4pirgf0009dljq0v7hmf0a	225-597-980-009	JUNIOR	ANIMATEUR	ABIDJAN	2026-02-27 09:45:51.999	2026-02-27 09:45:51.999
cmm4qk6630000bdqoyxc8lwzx	114-145-223-655	aka	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-27 10:14:57.339	2026-02-27 10:14:57.339
cmm4u58va0000125w1aizdr5h	343-545-657-687	Junior Akoudjé	ANIMATEUR	ABIDJAN	2026-02-27 11:55:19.463	2026-02-27 11:55:19.463
cmm4x6w7j0000a5twe8khaxwn	454-433-422-233	AKON LOUIS	ANIMATEUR	ABIDJAN	2026-02-27 13:20:35.208	2026-02-27 13:20:35.208
cmm0rj83l0003jq7po4cm7gzm	225-000-381-749	Pierre Emmanuel Danho	ANIMATEUR_ADJOINT	ABIDJAN	2026-02-24 15:31:08.095	2026-03-09 11:50:34.754
cmm64pn0i0000z24xloki2dfq	225-000-356-453	Koffi Seraphin	ANIMATEUR	ABIDJAN	2026-02-28 09:38:53.249	2026-02-28 09:38:53.249
cmm727wi40001zax68qfix8jd	123-465-699-852	DOGBO JEAN	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-01 01:16:52.683	2026-03-01 01:16:52.683
cmm83d7cn0000mqi7v82uu1sy	111-122-445-656	BANCE AIDA	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-01 18:36:45.814	2026-03-01 18:36:45.814
cmm83venr0003mqi7w8pm7qpn	123-456-789-464	BOUSSIM Aïda	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-01 18:50:55.094	2026-03-01 18:50:55.094
cmm8s9udo0000ui1zdjeelx6n	225-000-145-698	KONAN PARFAIT	MANAGER	ABIDJAN	2026-03-02 06:13:59.435	2026-03-02 06:13:59.435
cmm8vaxle000513iey1gkl236	225-000-451-236	BANCE AIDA	MANAGER	ABIDJAN	2026-03-02 07:38:49.105	2026-03-02 07:38:49.105
cmm91sgqq000011hbrthsles2	123-343-433-565	AKO	ANIMATEUR	ABIDJAN	2026-03-02 10:40:24.769	2026-03-02 10:40:24.769
cmm921x5t000311hb9533uw7c	225-000-053-535	Junior Akoudjé	ANIMATEUR	ABIDJAN	2026-03-02 10:47:45.878	2026-03-02 10:47:45.878
cmluwr1w8000ioho4qxrmym3l	225-000-111-222	AMLON	ANIMATEUR	ABIDJAN	2026-02-20 13:10:34.326	2026-03-02 11:55:54.073
cmm9cr7qo0000kt4zu7guw18n	222-000-111-222	AKA	ANIMATEUR	ABIDJAN	2026-03-02 15:47:22.224	2026-03-02 15:47:22.224
cmmdbwhgf00005m02t5png8rs	225-000-125-452	KONAN CEDRIC	MANAGER	ABIDJAN	2026-03-05 10:34:33.184	2026-03-05 10:34:33.184
cmmdcqzsw0000ew7nhvlihpxk	225-000-125-444	KRA CEDRIC	MANAGER	ABIDJAN	2026-03-05 10:58:16.641	2026-03-05 10:58:16.641
cmmdd8s67000hew7nechos8lc	123-456-785-521	REBECCA	ANIMATEUR	ABIDJAN	2026-03-05 11:12:06.56	2026-03-05 11:12:06.56
cmmdfg7eh00001kx99tsbwkqg	225-000-124-555	AKON LOUIS	MANAGER	ABIDJAN	2026-03-05 12:13:52.121	2026-03-05 12:13:52.121
cmmdj20to0000pgnucsj7ggqu	225-000-145-745	KRA JULIE	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-05 13:54:48.874	2026-03-05 13:54:48.874
cmmdj7jky001cpgnu9fyputs8	225-000-145-778	YAPO ELIE	MANAGER	ABIDJAN	2026-03-05 13:59:06.465	2026-03-05 13:59:06.465
cmmdjbcjq001vpgnuywnkrbxd	225-001-458-663	CISSE YAYA	MANAGER_ADJOINT	ABIDJAN	2026-03-05 14:02:03.972	2026-03-05 14:02:03.972
cmmdk48nf000075csy45r9j66	225-000-354-550	CISSE YAYA	ANIMATEUR	ABIDJAN	2026-03-05 14:24:31.946	2026-03-05 14:24:31.946
cmmewbw4z000010p8e0wudsfg	225-000-145-746	INZA FOFANA	ANIMATEUR	ABIDJAN	2026-03-06 12:54:10.548	2026-03-06 12:54:10.548
cmmeybka50000co9dggwuf0lz	225-114-588-445	AKA JOEL	ANIMATEUR	ABIDJAN	2026-03-06 13:49:54.411	2026-03-06 13:49:54.411
cmmeycnbe0010co9d2k9gphn9	222-525-457-547	AKA JOEL	ANIMATEUR	ABIDJAN	2026-03-06 13:50:45.002	2026-03-06 13:50:45.002
cmmeysa0u001yco9d81cc0bfi	225-541-257-422	AGOUSSI CHANTAL	MANAGER	ABIDJAN	2026-03-06 14:02:54.269	2026-03-06 14:02:54.269
cmmeytpkf002tco9d5q9sqzpz	225-000-000-872	AGO CHARLES	MANAGER_ADJOINT	ABIDJAN	2026-03-06 14:04:01.07	2026-03-06 14:04:01.07
cmmez9goq0043co9db11igqqc	226-000-147-852	BANCE ALIMAN	MANAGER	ABIDJAN	2026-03-06 14:16:15.993	2026-03-06 14:16:15.993
cmmfhzsay0000ph8f0s22ww5j	225-000-222-887	FRANCOIS SOUDAN	ANIMATEUR	ABIDJAN	2026-03-06 23:00:37.257	2026-03-06 23:00:37.257
cmmfjzb9p0000qpo58d87dj8s	226-457-145-789	BROU KONAN	ANIMATEUR	ABIDJAN	2026-03-06 23:56:14.413	2026-03-06 23:56:14.413
cmmfkq2pk0000oboswtct08nl	225-000-412-589	SORO KOLE	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-07 00:17:03.031	2026-03-07 00:17:03.031
cmmfkr9bs000tobosre3nmhwb	225-336-225-145	SORO KOLO	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-07 00:17:58.262	2026-03-07 00:17:58.262
cmmfm1eco0000hab8gbq6m4bf	225-000-111-444	FELIX ANDRE	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-07 00:53:50.951	2026-03-07 00:53:50.951
cmmfo45t700008184kayjg7wi	228-000-145-784	BANCE OUSMANE	MANAGER	ABIDJAN	2026-03-07 01:51:59.084	2026-03-07 01:51:59.084
cmlz8di1y000iub6y1n9l6zy4	225-000-123-456	BOUSSIM AIDA	MANAGER_ADJOINT	ABIDJAN	2026-02-23 13:47:02.132	2026-03-07 07:38:15.004
cmmg0jmuf0014x32g79db3157	225-000-145-521	BOUSSIM AIDA	MANAGER_ADJOINT	ABIDJAN	2026-03-07 07:39:56.388	2026-03-07 07:39:56.388
cmmg0l7v30028x32gh4ypsxsg	225-000-325-425	KOUASSI KOFFI	MANAGER	ABIDJAN	2026-03-07 07:41:10.285	2026-03-07 07:41:10.285
cmmg7wqzd0000lmbsjw7l6uz7	085-421-369-852	Kouakou florence	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-07 11:06:05.593	2026-03-07 11:06:05.593
cmmgannu800002izz4bpshbud	225-000-112-335	KOFFI JEAN	ANIMATEUR	ABIDJAN	2026-03-07 12:23:00.464	2026-03-07 12:23:00.464
cmmgavqa0000q2izzbu3zwlrv	225-008-745-236	Kra Kouadio	MANAGER_ADJOINT	ABIDJAN	2026-03-07 12:29:16.872	2026-03-07 12:29:16.872
cmmgr126p0000ng16s62wwcub	222-555-666-333	CLARISSE	ANIMATEUR	ABIDJAN	2026-03-07 20:01:19.441	2026-03-07 20:01:19.441
cmmhf7duu0009m988n0zdix93	225-000-856-087	KOUADIO KONAN	MANAGER	ABIDJAN	2026-03-08 07:18:05.286	2026-03-08 07:18:05.286
cmmi1dg2n00033na6kdr3ywre	225-000-852-665	SORE Claude	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-08 17:38:39.646	2026-03-08 17:38:39.646
cmmii5ra50000qjcwhy1czhoz	225-000-858-741	MARC	MANAGER	ABIDJAN	2026-03-09 01:28:34.396	2026-03-09 01:28:34.396
cmmiiauu4001eqjcwtjf7ccx7	225-000-142-125	COMOE	ANIMATEUR	ABIDJAN	2026-03-09 01:32:32.246	2026-03-09 01:32:32.246
cmmikvfu8000a4o4a4uv4rfwm	365-258-415-896	AMOIN	MANAGER	ABIDJAN	2026-03-09 02:44:31.855	2026-03-09 02:44:31.855
cmmin2hw30000fzqtyy0dsyje	114-555-222-588	Desnoces	MANAGER	ABIDJAN	2026-03-09 03:46:00.338	2026-03-09 03:46:00.338
cmmj0cmmy0000147aqf8zn4j5	225-000-101-219	AKISSI ADÉLAÏDE kouakou	MANAGER	ABIDJAN	2026-03-09 09:57:48.044	2026-03-09 09:57:48.044
cmmjb49440000xm3t4qcf1exu	225-000-129-990	Alla Blondeau sosthene	MANAGER	ABIDJAN	2026-03-09 14:59:13.059	2026-03-09 14:59:13.059
cmmjifs6t000070gmlapg8lag	225-443-233-345	KRA	MANAGER	ABIDJAN	2026-03-09 18:24:08.309	2026-03-09 18:24:08.309
cmmkjkrwj0000npuzrbhsy211	225-000-865-453	ALLA THERESE	ANIMATEUR	ABIDJAN	2026-03-10 11:43:47.012	2026-03-10 11:43:47.012
cmmkmt0ao000015hlc4dinm4u	345-533-356-688	KOKO	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-10 13:14:09.983	2026-03-10 13:14:09.983
cmmkqosj100005ihug3dc1gq7	225-000-324-365	REBECCA	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-10 15:02:51.758	2026-03-10 15:02:51.758
cmmkqw4mm00065ihucof95z6s	225-000-066-453	REBECCA	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-10 15:08:34.029	2026-03-10 15:08:34.029
cmmkra2l4000c5ihutebwajl6	222-232-343-545	kkkkk	ANIMATEUR	ABIDJAN	2026-03-10 15:19:24.569	2026-03-10 15:19:24.569
cmmkrfi1z000v5ihukcxk41qm	225-000-145-369	Carine	ANIMATEUR	ABIDJAN	2026-03-10 15:23:37.871	2026-03-10 15:23:37.871
cmmkrhq0u002c5ihul9pswmmu	225-000-254-147	Raoul	MANAGER	ABIDJAN	2026-03-10 15:25:21.533	2026-03-10 15:25:21.533
cmmkvsimk0000hugcxvw0azgq	225-000-169-850	AKA Laurent	MANAGER_ADJOINT	ABIDJAN	2026-03-10 17:25:43.627	2026-03-10 17:25:43.627
cmmkvtg0q0006hugcc81m9gdf	226-000-765-899	Isaac SEMILOI	MANAGER	ABIDJAN	2026-03-10 17:26:26.905	2026-03-10 17:26:26.905
cmmkvulsq000chugc1ajszx3j	225-007-485-953	Roland  Kouamé	ANIMATEUR	ABIDJAN	2026-03-10 17:27:21.048	2026-03-10 17:27:21.048
cmmkw0nni000ihugc5ln9qis8	225-000-745-896	DOGBO JEAN	MANAGER	ABIDJAN	2026-03-10 17:32:03.374	2026-03-10 17:32:03.374
cmmkyoi8a000a4fmm2iuxhdk2	226-000-123-432	SANOU KEVIN	ANIMATEUR	ABIDJAN	2026-03-10 18:46:35.337	2026-03-10 18:46:35.337
cmml67lvn0000nfmeb32io2k4	226-147-852-963	KOUAKOU	ANIMATEUR	ABIDJAN	2026-03-10 22:17:23.839	2026-03-10 22:17:23.839
cmml7uy060000a915ohprxtpg	114-523-669-874	AAAAAZ	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-10 23:03:32.262	2026-03-10 23:03:32.262
cmml8ngyv001ua915nslfp0vm	226-000-777-589	Alizeta NANA	MANAGER	ABIDJAN	2026-03-10 23:25:43.206	2026-03-10 23:25:43.206
cmmlsagxp000012xy22mudf47	225-000-475-852	ABIDJAN	MANAGER	ABIDJAN	2026-03-11 08:35:28.957	2026-03-11 08:35:28.957
cmmm1653l0000hxjg148po5i4	222-555-567-789	AKOUDJE DOGBO JEAN JUNIOR	ANIMATEUR	ABIDJAN	2026-03-11 12:44:03.534	2026-03-11 12:44:03.534
cmmm1hgd70006hxjgv0g727i4	225-000-123-445	KONAN CEDRIC	ANIMATEUR	ABIDJAN	2026-03-11 12:52:51.355	2026-03-11 12:52:51.355
cmmm1k07w0011hxjg6ort8bdj	225-000-145-677	KONAN CEDRIC	ANIMATEUR	ABIDJAN	2026-03-11 12:54:50.394	2026-03-11 12:54:50.394
cmmfk13u4000nqpo5rre2f569	225-000-145-236	ANGELA	MANAGER	ABIDJAN	2026-03-06 23:57:38.089	2026-03-12 07:11:09.283
cmmnbaiqe0000a885d2frj8mr	225-000-125-478	KOSSI	MANAGER	ABIDJAN	2026-03-12 10:15:10.162	2026-03-12 10:15:10.162
cmmnc5uxk000ya885q6516wws	225-000-114-785	AKA	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-12 10:39:32.311	2026-03-12 10:39:32.311
cmmnc6npx0014a885yw881qxw	222-585-222-364	AKA	ANIMATEUR_ADJOINT	ABIDJAN	2026-03-12 10:40:09.62	2026-03-12 10:40:09.62
cmmndbomp0000d4k8gd6kcjy4	225-000-114-526	Isaac SEMILOI	CLIENT_PRIVILEGIE	ABIDJAN	2026-03-12 11:12:03.698	2026-03-12 11:12:03.698
cmmnddm1h000nd4k88aerd7ey	225-000-125-636	SOROCOPI	MANAGER_ADJOINT	ABIDJAN	2026-03-12 11:13:33.65	2026-03-12 11:13:33.65
\.


--
-- Data for Name: FboCountry; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."FboCountry" (id, "fboId", "countryId", "pointDeVente", "isPrimary", "createdAt") FROM stdin;
\.


--
-- Data for Name: GradeDiscount; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."GradeDiscount" (id, grade, "discountPercent", "createdAt", "updatedAt", "countryId") FROM stdin;
cmml7vziw0007a9153zz2jb9d	CLIENT_PRIVILEGIE	0.00	2026-03-10 23:04:20.887	2026-03-10 23:04:20.887	cmmet7i4o0005zu1u2l587yvo
cmml7vziw0009a915m2q0jiat	ANIMATEUR_ADJOINT	0.00	2026-03-10 23:04:20.887	2026-03-10 23:04:20.887	cmmet7i4o0005zu1u2l587yvo
cmml7vziw000da915q0wgcapc	MANAGER_ADJOINT	0.00	2026-03-10 23:04:20.887	2026-03-10 23:04:20.887	cmmet7i4o0005zu1u2l587yvo
cmml7vziw000fa915akqqjsfq	MANAGER	0.00	2026-03-10 23:04:20.887	2026-03-10 23:04:20.887	cmmet7i4o0005zu1u2l587yvo
cmml7x8cs000ra91525z7uzrv	CLIENT_PRIVILEGIE	0.00	2026-03-10 23:05:18.987	2026-03-10 23:05:18.987	cmmet7itg000azu1ul2rrzr0i
cmml7x8cs000ta915mcd5xxj3	ANIMATEUR_ADJOINT	0.00	2026-03-10 23:05:18.987	2026-03-10 23:05:18.987	cmmet7itg000azu1ul2rrzr0i
cmmet7hqd0004zu1u6p99ez2d	ANIMATEUR	10.00	2026-03-06 11:26:46.405	2026-03-12 21:42:00.258	country_ci_default
cmml7x8cs000xa915uv1r92et	MANAGER_ADJOINT	0.00	2026-03-10 23:05:18.987	2026-03-10 23:05:18.987	cmmet7itg000azu1ul2rrzr0i
cmml7x8cs000za915sr8frofi	MANAGER	0.00	2026-03-10 23:05:18.987	2026-03-10 23:05:18.987	cmmet7itg000azu1ul2rrzr0i
cmml7xdju0011a915vfmd50we	CLIENT_PRIVILEGIE	0.00	2026-03-10 23:05:25.721	2026-03-10 23:05:25.721	cmmet7jjr000fzu1u0qabmha1
cmml7xdju0013a915r19t0vvo	ANIMATEUR_ADJOINT	0.00	2026-03-10 23:05:25.721	2026-03-10 23:05:25.721	cmmet7jjr000fzu1u0qabmha1
cmmet7ilx0009zu1u16toefup	ANIMATEUR	10.00	2026-03-06 11:26:47.541	2026-03-12 21:42:00.357	cmmet7i4o0005zu1u2l587yvo
cmml7xdju0017a91545gv44im	MANAGER_ADJOINT	0.00	2026-03-10 23:05:25.721	2026-03-10 23:05:25.721	cmmet7jjr000fzu1u0qabmha1
cmml7xdju0019a915pwp5awem	MANAGER	0.00	2026-03-10 23:05:25.721	2026-03-10 23:05:25.721	cmmet7jjr000fzu1u0qabmha1
cmml7xj76001ba915sw5horrd	CLIENT_PRIVILEGIE	0.00	2026-03-10 23:05:33.042	2026-03-10 23:05:33.042	cmmet7ka5000kzu1u17js0tjx
cmml7xj76001da915sls7j3wg	ANIMATEUR_ADJOINT	0.00	2026-03-10 23:05:33.042	2026-03-10 23:05:33.042	cmmet7ka5000kzu1u17js0tjx
cmmet7jb9000ezu1u4555va7c	ANIMATEUR	10.00	2026-03-06 11:26:48.453	2026-03-12 21:42:00.456	cmmet7itg000azu1ul2rrzr0i
cmml7xj77001ha915zy3rul5x	MANAGER_ADJOINT	0.00	2026-03-10 23:05:33.042	2026-03-10 23:05:33.042	cmmet7ka5000kzu1u17js0tjx
cmml7xj77001ja9154egsqvo1	MANAGER	0.00	2026-03-10 23:05:33.042	2026-03-10 23:05:33.042	cmmet7ka5000kzu1u17js0tjx
cmmkymz1h00014fmmoh0w0dgj	CLIENT_PRIVILEGIE	5.00	2026-03-10 18:45:23.812	2026-03-10 23:18:53.733	country_ci_default
cmmkymz1h00034fmmiydd4mnu	ANIMATEUR_ADJOINT	30.00	2026-03-10 18:45:23.812	2026-03-10 23:18:53.733	country_ci_default
cmmet7k2y000jzu1ubd909uyp	ANIMATEUR	10.00	2026-03-06 11:26:49.45	2026-03-12 21:42:00.469	cmmet7jjr000fzu1u0qabmha1
cmmkymz1h00074fmma6xk2bol	MANAGER_ADJOINT	43.00	2026-03-10 18:45:23.812	2026-03-10 23:18:53.733	country_ci_default
cmmjcsh6t0004beh1jywp2gw2	ANIMATEUR	10.00	2026-03-09 15:46:02.886	2026-03-10 12:49:23.147	cmmjcsh6h0000beh1qkkqeruu
cmmjcsh8t0009beh1gax7p41n	ANIMATEUR	10.00	2026-03-09 15:46:02.957	2026-03-10 12:49:23.211	cmmjcsh8m0005beh1guy9un9y
cmmjcsh92000ebeh169usvw8j	ANIMATEUR	10.00	2026-03-09 15:46:02.967	2026-03-10 12:49:23.223	cmmjcsh8w000abeh1i8qsufkx
cmmjcsh9d000jbeh1yxm1vkl7	ANIMATEUR	10.00	2026-03-09 15:46:02.977	2026-03-10 12:49:23.234	cmmjcsh96000fbeh13dy2my8i
cmmjcsh9m000obeh1hy9ypls8	ANIMATEUR	10.00	2026-03-09 15:46:02.986	2026-03-10 12:49:23.243	cmmjcsh9h000kbeh11v3s4pdx
cmmkymz1h00094fmmqguilsso	MANAGER	48.00	2026-03-10 18:45:23.812	2026-03-10 23:18:53.733	country_ci_default
cmmet7koz000ozu1ubnz9yr9s	ANIMATEUR	10.00	2026-03-06 11:26:50.243	2026-03-12 21:42:00.561	cmmet7ka5000kzu1u17js0tjx
\.


--
-- Data for Name: OrderMessage; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."OrderMessage" (id, "preorderId", channel, purpose, status, "toPhone", body, provider, "providerMessageId", "paymentLinkTracked", "paymentLinkTarget", "sentAt", "deliveredAt", "readAt", "failedAt", "lastStatusAt", "errorCode", "errorMessage", "createdBy", "createdAt", "updatedAt") FROM stdin;
cmmij0jw300054o4ae0048xbw	cmmiiauuu001hqjcwxgyvmewh	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour COMOE,\nVotre préfacture 20251452 d’un montant de 49 050 FCFA est prête.\nLien de paiement : https://appfbo-backend.onrender.com/pay/o/cmmiiauuu001hqjcwxgyvmewh/cmmij0jw300054o4ae0048xbw	SIMULATED	sim_1773021151166	https://appfbo-backend.onrender.com/pay/o/cmmiiauuu001hqjcwxgyvmewh/cmmij0jw300054o4ae0048xbw	https://pay.example.com/preorders/cmmiiauuu001hqjcwxgyvmewh?invoice=20251452	2026-03-09 01:52:31.166	\N	\N	\N	2026-03-09 01:52:31.166	\N	\N	admin@forever.ci	2026-03-09 01:52:31.155	2026-03-09 01:52:31.167
cmmikx9oq00124o4ao1u2kve5	cmmikvfui000d4o4apwj0j5o4	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour AMOIN,\nVotre préfacture 47556325 d’un montant de 52 000 FCFA est prête.\nLien de paiement : https://appfbo-backend.onrender.com/pay/o/cmmikvfui000d4o4apwj0j5o4/cmmikx9oq00124o4ao1u2kve5	SIMULATED	sim_1773024357201	https://appfbo-backend.onrender.com/pay/o/cmmikvfui000d4o4apwj0j5o4/cmmikx9oq00124o4ao1u2kve5	https://pay.example.com/preorders/cmmikvfui000d4o4apwj0j5o4?invoice=47556325	2026-03-09 02:45:57.201	\N	\N	\N	2026-03-09 02:45:57.201	\N	\N	admin@forever.ci	2026-03-09 02:45:57.195	2026-03-09 02:45:57.202
cmmjb7xi80015xm3tbb4h311a	cmmjb494e0003xm3tbt47lghg	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour Alla Blondeau sosthene,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 27302\nNuméro FBO : 225-000-129-990\nMontant à payer : 68 000 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_Y1WF00nLXR\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	SIMULATED	sim_1773068524650	https://appfbo-backend.onrender.com/pay/o/cmmjb494e0003xm3tbt47lghg/cmmjb7xi80015xm3tbb4h311a	https://paydunya.com/sandbox-checkout/invoice/test_Y1WF00nLXR	2026-03-09 15:02:04.65	\N	\N	\N	2026-03-09 15:02:04.65	\N	\N	admin@forever.ci	2026-03-09 15:02:04.64	2026-03-09 15:02:04.65
cmmin3rbz000lfzqtkzsw9qz1	cmmin2hwc0003fzqtom2f5et1	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour Desnoces,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 24578521\nNuméro FBO : 114-555-222-588\nMontant à payer : 65 500 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_ZrAm1TUmbL\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	SIMULATED	sim_1773028019244	https://appfbo-backend.onrender.com/pay/o/cmmin2hwc0003fzqtom2f5et1/cmmin3rbz000lfzqtkzsw9qz1	https://paydunya.com/sandbox-checkout/invoice/test_ZrAm1TUmbL	2026-03-09 03:46:59.244	\N	\N	\N	2026-03-09 03:46:59.244	\N	\N	admin@forever.ci	2026-03-09 03:46:59.231	2026-03-09 03:46:59.245
cmmj0kd460022147a4cmlz11k	cmmj0cmng0003147a0uuk27cz	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour AKISSI ADÉLAÏDE kouakou,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : PF-2026-UK27CZ\nNuméro FBO : 225-000-101-219\nMontant à payer : 121 500 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_uXlb1WKg8u\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	SIMULATED	sim_1773050628974	https://appfbo-backend.onrender.com/pay/o/cmmj0cmng0003147a0uuk27cz/cmmj0kd460022147a4cmlz11k	https://paydunya.com/sandbox-checkout/invoice/test_uXlb1WKg8u	2026-03-09 10:03:48.974	\N	\N	\N	2026-03-09 10:03:48.974	\N	\N	admin@forever.ci	2026-03-09 10:03:48.966	2026-03-09 10:03:48.974
cmmj4vfku001010c25lh5bvjs	cmmj4dnuz000310c22dko6wk9	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour Pierre Emmanuel Danho,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : PF-2026-KO6WK9\nNuméro FBO : 225-000-381-749\nMontant à payer : 40 000 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_9N0BWxTLUw\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	SIMULATED	sim_1773057863848	https://appfbo-backend.onrender.com/pay/o/cmmj4dnuz000310c22dko6wk9/cmmj4vfku001010c25lh5bvjs	https://paydunya.com/sandbox-checkout/invoice/test_9N0BWxTLUw	2026-03-09 12:04:23.848	\N	\N	\N	2026-03-09 12:04:23.848	\N	\N	admin@forever.ci	2026-03-09 12:04:23.838	2026-03-09 12:04:23.849
cmmm1n8r1002ahxjgwrqevv67	cmmm1k0830014hxjg53foxruc	WHATSAPP	PAYMENT_LINK	SENT	+2250506025071	Bonjour KONAN CEDRIC,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 2454670\nNuméro FBO : 225-000-145-677\nMontant à payer : 50 850 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_sWbMHiDuzV\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	SIMULATED	sim_1773233841430	https://appfbo-backend.onrender.com/pay/o/cmmm1k0830014hxjg53foxruc/cmmm1n8r1002ahxjgwrqevv67	https://paydunya.com/sandbox-checkout/invoice/test_sWbMHiDuzV	2026-03-11 12:57:21.43	\N	\N	\N	2026-03-11 12:57:21.43	\N	\N	admin@forever.ci	2026-03-11 12:57:21.421	2026-03-11 12:57:21.431
\.


--
-- Data for Name: OrderMessageEvent; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."OrderMessageEvent" (id, "orderMessageId", status, "rawPayload", note, "createdAt") FROM stdin;
cmmij0jwj00074o4aslenmkly	cmmij0jw300054o4ae0048xbw	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmiiauuu001hqjcwxgyvmewh", "orderMessageId": "cmmij0jw300054o4ae0048xbw"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 01:52:31.171
cmmikx9p100144o4a53xb3pi4	cmmikx9oq00124o4ao1u2kve5	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmikvfui000d4o4apwj0j5o4", "orderMessageId": "cmmikx9oq00124o4ao1u2kve5"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 02:45:57.205
cmmin3rcj000nfzqtivnqmwb9	cmmin3rbz000lfzqtkzsw9qz1	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmin2hwc0003fzqtom2f5et1", "orderMessageId": "cmmin3rbz000lfzqtkzsw9qz1"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 03:46:59.251
cmmj0kd4h0024147azifoi4bg	cmmj0kd460022147a4cmlz11k	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmj0cmng0003147a0uuk27cz", "orderMessageId": "cmmj0kd460022147a4cmlz11k"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 10:03:48.978
cmmj4vfl8001210c261rsr6nl	cmmj4vfku001010c25lh5bvjs	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmj4dnuz000310c22dko6wk9", "orderMessageId": "cmmj4vfku001010c25lh5bvjs"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 12:04:23.852
cmmjb7xil0017xm3tvnz78qe6	cmmjb7xi80015xm3tbb4h311a	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmjb494e0003xm3tbt47lghg", "orderMessageId": "cmmjb7xi80015xm3tbb4h311a"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-09 15:02:04.654
cmmm1n8re002chxjgqa6zor9x	cmmm1n8r1002ahxjgwrqevv67	SENT	{"ok": true, "to": "2250506025071", "metadata": {"purpose": "PAYMENT_LINK", "preorderId": "cmmm1k0830014hxjg53foxruc", "orderMessageId": "cmmm1n8r1002ahxjgwrqevv67"}, "simulated": true}	Message WhatsApp de facturation envoyé.	2026-03-11 12:57:21.434
\.


--
-- Data for Name: Preorder; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."Preorder" (id, status, "fboId", "fboNumero", "fboNomComplet", "fboGrade", "pointDeVente", "paymentMode", "deliveryMode", "totalCc", "totalPoidsKg", "totalProduitsFcfa", "fraisLivraisonFcfa", "totalFcfa", "whatsappMessage", "factureReference", "factureWhatsappTo", "createdAt", "updatedAt", "submittedAt", "paidAt", "cancelReason", "cancelledAt", "cancelledBy", "deliveryTracking", "fulfilledAt", "fulfilledBy", "internalNote", "invoicedAt", "invoicedBy", "packingNote", "paymentLink", "paymentProofNote", "paymentProofUrl", "paymentRef", "paymentVerifiedBy", "preparedAt", "preparedBy", "proofReceivedAt", "proofReceivedBy", "countryId", "cancelledById", "fulfilledById", "invoicedById", "paymentVerifiedById", "preparedById", "proofReceivedById", "paymentVerifiedAt", "stockDeductedAt", "stockRestoredAt", "lastWhatsappMessageId", "lastWhatsappStatus", "lastWhatsappStatusAt", "paymentLinkClickCount", "paymentLinkClickedAt") FROM stdin;
cmmm1653u0003hxjgjcjssh1q	DRAFT	cmmm1653l0000hxjg148po5i4	222-555-567-789	AKOUDJE DOGBO JEAN JUNIOR	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-11 12:44:03.546	2026-03-11 12:44:03.546	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmgr128g0003ng164v3p631u	PAID	cmmgr126p0000ng16s62wwcub	222-555-666-333	CLARISSE	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.272	0.072	52650	0	52650	Bonjour CLARISSE,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 451254\nNuméro FBO : 222-555-666-333\nMontant à payer : 52 650 FCFA\n\nMerci de vous présenter au bureau pour effectuer le règlement en espèces.\nVotre commande sera préparée après validation du paiement.\n\nMerci.\nFOREVER	451254	+2250506025071	2026-03-07 20:01:19.505	2026-03-07 20:03:12.757	2026-03-07 20:01:46.522	2026-03-07 20:03:12.755	\N	\N	\N	\N	\N	\N	52650	2026-03-07 20:02:49.071	admin@forever.ci	\N	\N	\N	\N	\N	admin@forever.ci	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	\N	2026-03-07 20:03:12.755	\N	\N	\N	\N	\N	0	\N
cmmn4pvjj0003scfq8uuqywau	DRAFT	cmmfk13u4000nqpo5rre2f569	225-000-145-236	ANGELA	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-12 07:11:09.295	2026-03-12 07:11:09.295	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmeysa160021co9docxg9cg7	DRAFT	cmmeysa0u001yco9d81cc0bfi	225-541-257-422	AGOUSSI CHANTAL	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.621	0.900	135000	0	135000	\N	\N	\N	2026-03-06 14:02:54.283	2026-03-06 14:03:16.214	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkjkrws0003npuzq2edy64n	DRAFT	cmmkjkrwj0000npuzrbhsy211	225-000-865-453	ALLA THERESE	ANIMATEUR	ABIDJAN	WAVE	LIVRAISON	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 11:43:47.02	2026-03-10 11:43:47.02	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	cmmjcsh6h0000beh1qkkqeruu	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmg0hgmb0003x32gpt92ynd1	DRAFT	cmlz8di1y000iub6y1n9l6zy4	225-000-123-456	BOUSSIM AIDA	MANAGER_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.228	0.270	50500	0	50500	\N	\N	\N	2026-03-07 07:38:15.012	2026-03-07 07:38:45.984	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmml7uy0e0003a9157u2zj2u0	DRAFT	cmml7uy060000a915ohprxtpg	114-523-669-874	AAAAAZ	CLIENT_PRIVILEGIE	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.552	2.282	114475	0	114475	\N	\N	\N	2026-03-10 23:03:32.27	2026-03-12 10:30:14.959	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmnddm1p000qd4k804yjl4lt	SUBMITTED	cmmnddm1h000nd4k88aerd7ey	225-000-125-636	SOROCOPI	MANAGER_ADJOINT	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.409	0.476	50730	0	50730	- PRÉCOMMANDE FLP CIV -\nPrécommande N° : cmmnddm1p000qd4k804yjl4lt\nFBO : 225-000-125-636\nNom : SOROCOPI\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : ESPECES\n\nProduits demandés :\n- x 1 | SKU: 71 | Garcinia Plus | 14 820 FCFA | 0.12 CC\n- x 1 | SKU: 289 | Forever Lean | 20 805 FCFA | 0.167 CC\n- x 1 | SKU: 471 | Forever Lite Ultra Chocolat | 15 105 FCFA | 0.122 CC\n\nTotaux :\nProduits : 50 730 FCFA\nLivraison : 0 FCFA\nGLOBAL : 50 730 FCFA	\N	+2250506025071	2026-03-12 11:13:33.661	2026-03-12 11:14:09.096	2026-03-12 11:14:09.095	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmg0l7v8002bx32gq137c276	PAID	cmmg0l7v30028x32gh4ypsxsg	225-000-325-425	KOUASSI KOFFI	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.356	2.230	78500	0	78500	Bonjour KOUASSI KOFFI,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : PF250254\nNuméro FBO : 225-000-325-425\nMontant totalà payer : 78 500 FCFA\n\nVeuillez finaliser votre paiement via le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_prN559aJFY\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	PF250254	+2250506025071	2026-03-07 07:41:10.292	2026-03-07 07:47:08.767	2026-03-07 07:41:40.291	2026-03-07 07:47:08.766	\N	\N	\N	\N	\N	\N	\N	2026-03-07 07:45:21.236	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_prN559aJFY	\N	\N	test_prN559aJFY	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-07 07:47:08.766	\N	\N	\N	\N	\N	0	\N
cmmkra2lh000f5ihu7lynpaty	SUBMITTED	cmmkra2l4000c5ihutebwajl6	222-232-343-545	kkkkk	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.533	2.000	103950	0	103950	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmkra2lh000f5ihu7lynpaty\nFBO : 222-232-343-545\nNom : kkkkk\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : ESPECES\n\nProduits demandés :\n- x 1 | SKU: 659 | DX4 | 103 950 FCFA | 0.533 CC\n\nTotaux :\nProduits : 103 950 FCFA\nLivraison : 0 FCFA\nGLOBAL : 103 950 FCFA	\N	+2250506025071	2026-03-10 15:19:24.581	2026-03-10 15:19:52.96	2026-03-10 15:19:52.959	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmeytpkk002wco9dongbaxj8	FULFILLED	cmmeytpkf002tco9d5q9sqzpz	225-000-000-872	AGO CHARLES	MANAGER_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.690	1.000	150000	0	150000	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmeytpkk002wco9dongbaxj8\nFBO: 225-000-000-872\nNom: AGO CHARLES\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: WAVE\n\n Produits demandé :\n- x10 48 Absorbent-C | 150000 FCFA | 0.69 CC\n\n Totaux:\nProduits: 150000 FCFA\nLivraison: 0 FCFA\nGLOBAL: 150000 FCFA	PF -2501452	+2250506025071	2026-03-06 14:04:01.077	2026-03-06 14:06:20.637	2026-03-06 14:04:23.063	2026-03-06 14:06:03.881	\N	\N	\N	\N	2026-03-06 14:06:20.637	admin@forever.ci	\N	2026-03-06 14:05:21.054	admin@forever.ci	\N	\N	\N	\N	\N	admin@forever.ci	2026-03-06 14:06:12.366	admin@forever.ci	2026-03-06 14:05:48.489	admin@forever.ci	country_ci_default	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	2026-03-06 14:06:03.881	2026-03-06 14:06:12.366	\N	\N	\N	\N	0	\N
cmmiiauuu001hqjcwxgyvmewh	INVOICED	cmmiiauu4001eqjcwtjf7ccx7	225-000-142-125	COMOE	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.250	0.640	49050	0	49050	Bonjour COMOE,\nVotre préfacture 20251452 d’un montant de 49 050 FCFA est prête.\nLien de paiement : https://appfbo-backend.onrender.com/pay/o/cmmiiauuu001hqjcwxgyvmewh/cmmij0jw300054o4ae0048xbw	20251452	+2250506025071	2026-03-09 01:32:32.31	2026-03-09 01:52:31.175	2026-03-09 01:51:16.203	\N	\N	\N	\N	\N	\N	\N	\N	2026-03-09 01:52:31.166	admin@forever.ci	\N	https://pay.example.com/preorders/cmmiiauuu001hqjcwxgyvmewh?invoice=20251452	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	\N	\N	\N	cmmij0jw300054o4ae0048xbw	SENT	2026-03-09 01:52:31.166	0	\N
cmmfkq2pz0003obosmskoczag	DRAFT	cmmfkq2pk0000oboswtct08nl	225-000-412-589	SORO KOLE	CLIENT_PRIVILEGIE	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.169	1.100	37000	0	37000	\N	\N	\N	2026-03-07 00:17:03.047	2026-03-07 00:17:21.123	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmj0cmng0003147a0uuk27cz	FULFILLED	cmmj0cmmy0000147aqf8zn4j5	225-000-101-219	AKISSI ADÉLAÏDE kouakou	MANAGER	ABIDJAN	ORANGE_MONEY	LIVRAISON	0.550	0.600	120500	1000	121500	Bonjour AKISSI ADÉLAÏDE kouakou,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : PF-2026-UK27CZ\nNuméro FBO : 225-000-101-219\nMontant à payer : 121 500 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_uXlb1WKg8u\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	PF-2026-UK27CZ	+2250506025071	2026-03-09 09:57:48.076	2026-03-09 11:22:07.871	2026-03-09 10:02:14.561	2026-03-09 10:06:58.231	\N	\N	\N	\N	2026-03-09 11:22:07.87	admin@forever.ci	\N	2026-03-09 10:03:48.974	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_uXlb1WKg8u	\N	\N	test_uXlb1WKg8u	PAYDUNYA_WEBHOOK	2026-03-09 11:20:35.022	admin@forever.ci	\N	\N	country_ci_default	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	\N	2026-03-09 10:06:58.231	2026-03-09 11:20:35.022	\N	cmmj0kd460022147a4cmlz11k	SENT	2026-03-09 10:03:48.974	0	\N
cmmkvsims0003hugckpy9kv0b	DRAFT	cmmkvsimk0000hugcxvw0azgq	225-000-169-850	AKA Laurent	MANAGER_ADJOINT	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 17:25:43.636	2026-03-10 17:25:43.636	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkvtg0y0009hugczze7p9ob	DRAFT	cmmkvtg0q0006hugcc81m9gdf	226-000-765-899	Isaac SEMILOI	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 17:26:26.915	2026-03-10 17:26:26.915	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkvulsz000fhugc77x7qgt7	DRAFT	cmmkvulsq000chugc1ajszx3j	225-007-485-953	Roland  Kouamé	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 17:27:21.06	2026-03-10 17:27:21.06	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmhf7dv4000cm988xspalpqy	PAID	cmmhf7duu0009m988n0zdix93	225-000-856-087	KOUADIO KONAN	MANAGER	ABIDJAN	ORANGE_MONEY	RETRAIT_SITE_FLP	0.503	0.893	109480	0	109480	Bonjour KOUADIO KONAN,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 457125\nNuméro FBO : 225-000-856-087\nMontant à payer : 109 480 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_LK3W9y6fJo\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	457125	+2250506025071	2026-03-08 07:18:05.296	2026-03-08 07:39:25.084	2026-03-08 07:18:37.489	2026-03-08 07:39:25.084	\N	\N	\N	\N	\N	\N	\N	2026-03-08 07:37:52.115	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_LK3W9y6fJo	\N	\N	test_LK3W9y6fJo	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-08 07:39:25.084	\N	\N	\N	\N	\N	0	\N
cmmez9gq90046co9dwndbxn2d	PAID	cmmez9goq0043co9db11igqqc	226-000-147-852	BANCE ALIMAN	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.400	4.000	88000	0	88000	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmez9gq90046co9dwndbxn2d\nFBO: 226-000-147-852\nNom: BANCE ALIMAN\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: WAVE\n\n Produits demandé :\n- x4 34 Aloe Berry Nectar | 88000 FCFA | 0.4 CC\n\n Totaux:\nProduits: 88000 FCFA\nLivraison: 0 FCFA\nGLOBAL: 88000 FCFA	PF-20260306-226000147852	+2250506025071	2026-03-06 14:16:16.113	2026-03-08 17:34:54.66	2026-03-06 14:16:45.901	2026-03-08 17:34:54.656	\N	\N	\N	\N	\N	\N	\N	2026-03-06 22:24:19.623	admin@forever.ci	\N	\N	\N	\N	\N	admin@forever.ci	\N	\N	2026-03-06 22:24:31.351	admin@forever.ci	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	2026-03-08 17:34:54.656	\N	\N	\N	\N	\N	0	\N
cmmm1hgdf0009hxjg57wtgvk1	DRAFT	cmmm1hgd70006hxjgv0g727i4	225-000-123-445	KONAN CEDRIC	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.269	2.100	53100	0	53100	\N	\N	\N	2026-03-11 12:52:51.363	2026-03-11 12:53:27.922	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmnbaiqx0003a885aom49f18	DRAFT	cmmnbaiqe0000a885d2frj8mr	225-000-125-478	KOSSI	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-12 10:15:10.185	2026-03-12 10:15:10.185	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmj4dnuz000310c22dko6wk9	FULFILLED	cmm0rj83l0003jq7po4cm7gzm	225-000-381-749	Pierre Emmanuel Danho	ANIMATEUR_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.179	1.312	40000	0	40000	Bonjour Pierre Emmanuel Danho,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : PF-2026-KO6WK9\nNuméro FBO : 225-000-381-749\nMontant à payer : 40 000 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_9N0BWxTLUw\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	PF-2026-KO6WK9	+2250506025071	2026-03-09 11:50:34.763	2026-03-09 12:07:02.373	2026-03-09 12:03:28.879	2026-03-09 12:05:11.775	\N	\N	\N	\N	2026-03-09 12:07:02.373	admin@forever.ci	\N	2026-03-09 12:04:23.848	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_9N0BWxTLUw	\N	\N	test_9N0BWxTLUw	PAYDUNYA_WEBHOOK	2026-03-09 12:06:01.646	admin@forever.ci	\N	\N	country_ci_default	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	\N	2026-03-09 12:05:11.775	2026-03-09 12:06:01.646	\N	cmmj4vfku001010c25lh5bvjs	SENT	2026-03-09 12:04:23.848	0	\N
cmmikvfui000d4o4apwj0j5o4	INVOICED	cmmikvfu8000a4o4a4uv4rfwm	365-258-415-896	AMOIN	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.247	0.200	52000	0	52000	Bonjour AMOIN,\nVotre préfacture 47556325 d’un montant de 52 000 FCFA est prête.\nLien de paiement : https://appfbo-backend.onrender.com/pay/o/cmmikvfui000d4o4apwj0j5o4/cmmikx9oq00124o4ao1u2kve5	47556325	+2250506025071	2026-03-09 02:44:31.866	2026-03-09 02:45:57.208	2026-03-09 02:44:51.855	\N	\N	\N	\N	\N	\N	\N	\N	2026-03-09 02:45:57.201	admin@forever.ci	\N	https://pay.example.com/preorders/cmmikvfui000d4o4apwj0j5o4?invoice=47556325	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	\N	\N	\N	cmmikx9oq00124o4ao1u2kve5	SENT	2026-03-09 02:45:57.201	0	\N
cmmkmt0bi000315hlrl8sms8j	DRAFT	cmmkmt0ao000015hlc4dinm4u	345-533-356-688	KOKO	ANIMATEUR_ADJOINT	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 13:14:10.014	2026-03-10 13:14:10.014	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	cmmjcsh6h0000beh1qkkqeruu	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmg7wqzu0003lmbsvydsd79u	INVOICED	cmmg7wqzd0000lmbsjw7l6uz7	085-421-369-852	Kouakou florence	CLIENT_PRIVILEGIE	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.196	1.200	43500	0	43500	Bonjour Kouakou florence,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 254125\nNuméro FBO : 085-421-369-852\nMontant à payer : 43 500 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_I9M21ponM4\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	254125	+2250506025071	2026-03-07 11:06:05.61	2026-03-08 07:14:01.051	2026-03-07 11:09:13.362	\N	\N	\N	\N	\N	\N	\N	\N	2026-03-08 07:14:00.307	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_I9M21ponM4	\N	\N	test_I9M21ponM4	\N	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmfkr9bx000wobosmgo8zsa0	PAID	cmmfkr9bs000tobosre3nmhwb	225-336-225-145	SORO KOLO	CLIENT_PRIVILEGIE	ABIDJAN	ORANGE_MONEY	RETRAIT_SITE_FLP	0.169	1.100	37000	0	37000	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmfkr9bx000wobosmgo8zsa0\nFBO: 225-336-225-145\nNom: SORO KOLO\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: ORANGE_MONEY\n\n Produits demandé :\n- x 1 | SKU: 34 | Aloe Berry Nectar | 22000 FCFA | 0.1 CC\n- x 1 | SKU: 48 | Absorbent-C | 15000 FCFA | 0.069 CC\n\n Totaux:\nProduits: 37000 FCFA\nLivraison: 0 FCFA\nGLOBAL: 37000 FCFA	74589623	+2250506025071	2026-03-07 00:17:58.269	2026-03-07 00:20:00.521	2026-03-07 00:18:17.278	2026-03-07 00:20:00.521	\N	\N	\N	\N	\N	\N	\N	2026-03-07 00:19:19.326	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_KQfuti1Qv0	\N	\N	test_KQfuti1Qv0	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-07 00:20:00.521	\N	\N	\N	\N	\N	0	\N
cmml8ngz8001xa915uw1nlain	SUBMITTED	cmml8ngyv001ua915nslfp0vm	226-000-777-589	Alizeta NANA	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.533	2.000	60060	0	60060	- PRÉCOMMANDE FLP CIV -\nPrécommande N° : cmml8ngz8001xa915uw1nlain\nFBO : 226-000-777-589\nNom : Alizeta NANA\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : WAVE\n\nProduits demandés :\n- x 1 | SKU: 659 | DX4 | 60 060 FCFA | 0.533 CC\n\nTotaux :\nProduits : 60 060 FCFA\nLivraison : 0 FCFA\nGLOBAL : 60 060 FCFA	\N	+2250506025071	2026-03-10 23:25:43.22	2026-03-10 23:26:16.047	2026-03-10 23:26:16.046	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmg0jmum0017x32gyuzpcvrm	DRAFT	cmmg0jmuf0014x32g79db3157	225-000-145-521	BOUSSIM AIDA	MANAGER_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.256	1.230	56500	0	56500	\N	\N	\N	2026-03-07 07:39:56.398	2026-03-07 07:40:18.12	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkrfi2w000y5ihut1oggkt9	SUBMITTED	cmmkrfi1z000v5ihukcxk41qm	225-000-145-369	Carine	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.192	0.290	41400	0	41400	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmkrfi2w000y5ihut1oggkt9\nFBO : 225-000-145-369\nNom : Carine\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : ESPECES\n\nProduits demandés :\n- x 1 | SKU: 284 | Aloe Avocado Face & Body Soap | 5 850 FCFA | 0.027 CC\n- x 1 | SKU: 28 | Forever Bright | 6 300 FCFA | 0.032 CC\n- x 1 | SKU: 22 | Forever Aloe Lips | 3 150 FCFA | 0.014 CC\n- x 1 | SKU: 564 | Aloe Heat Lotion | 11 700 FCFA | 0.06 CC\n- x 1 | SKU: 61 | Gelée Aloès - Aloe Verra Gelly | 14 400 FCFA | 0.059 CC\n\nTotaux :\nProduits : 41 400 FCFA\nLivraison : 0 FCFA\nGLOBAL : 41 400 FCFA	\N	+2250506025071	2026-03-10 15:23:37.928	2026-03-10 15:24:33.13	2026-03-10 15:24:33.128	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkw0np7000lhugchbuaxag8	DRAFT	cmmkw0nni000ihugc5ln9qis8	225-000-745-896	DOGBO JEAN	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 17:32:03.452	2026-03-10 17:32:03.452	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmlsagxy000312xyntjpzq91	SUBMITTED	cmmlsagxp000012xy22mudf47	225-000-475-852	ABIDJAN	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	1.012	4.344	114400	0	114400	- PRÉCOMMANDE FLP CIV -\nPrécommande N° : cmmlsagxy000312xyntjpzq91\nFBO : 225-000-475-852\nNom : ABIDJAN\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : ESPECES\n\nProduits demandés :\n- x 1 | SKU: 34 | Aloe Berry Nectar | 11 440 FCFA | 0.1 CC\n- x 1 | SKU: 721 | FAB - Forever Active Boost | 2 600 FCFA | 0.019 CC\n- x 1 | SKU: 564 | Aloe Heat Lotion | 6 760 FCFA | 0.06 CC\n- x 1 | SKU: 77 | Coeur d'Aloes | 11 440 FCFA | 0.1 CC\n- x 1 | SKU: 686 | Forerver Vitamine C | 22 100 FCFA | 0.2 CC\n- x 1 | SKU: 659 | DX4 | 60 060 FCFA | 0.533 CC\n\nTotaux :\nProduits : 114 400 FCFA\nLivraison : 0 FCFA\nGLOBAL : 114 400 FCFA	\N	+2250506025071	2026-03-11 08:35:28.967	2026-03-11 08:36:29.046	2026-03-11 08:36:29.045	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmgannw700032izzvgvklsa7	PAID	cmmgannu800002izz4bpshbud	225-000-112-335	KOFFI JEAN	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.200	2.000	39600	0	39600	Bonjour KOFFI JEAN,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 2545178\nNuméro FBO : 225-000-112-335\nMontant à payer : 39 600 FCFA\n\nMerci de vous présenter au bureau pour effectuer le règlement en espèces.\nVotre commande sera préparée après validation du paiement.\n\nMerci.\nFOREVER	2545178	+2250506025071	2026-03-07 12:23:00.535	2026-03-08 17:59:21.864	2026-03-07 12:23:48.746	2026-03-08 17:59:21.86	\N	\N	\N	\N	\N	\N	39600	2026-03-08 17:58:49.03	admin@forever.ci	\N	\N	\N	\N	\N	admin@forever.ci	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	\N	2026-03-08 17:59:21.86	\N	\N	\N	\N	\N	0	\N
cmmfhzsb40003ph8fdm5yzh9u	PAID	cmmfhzsay0000ph8f0s22ww5j	225-000-222-887	FRANCOIS SOUDAN	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.192	0.120	37800	0	37800	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmfhzsb40003ph8fdm5yzh9u\nFBO: 225-000-222-887\nNom: FRANCOIS SOUDAN\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: WAVE\n\n Produits demandé :\n- x 1 | SKU: 65 | Forever Ail et Thym | 14400 FCFA | 0.072 CC\n- x 1 | SKU: 376 | Forever Artic Sea | 23400 FCFA | 0.12 CC\n\n Totaux:\nProduits: 37800 FCFA\nLivraison: 0 FCFA\nGLOBAL: 37800 FCFA	PF-20260306-225000222887	+2250506025071	2026-03-06 23:00:37.264	2026-03-06 23:43:05.454	2026-03-06 23:01:17.959	2026-03-06 23:43:05.451	\N	\N	\N	\N	\N	\N	\N	2026-03-06 23:26:42.638	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_eaw1tB7lJ3	\N	\N	test_eaw1tB7lJ3	admin@forever.ci	\N	\N	2026-03-06 23:31:52.754	admin@forever.ci	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	2026-03-06 23:43:05.451	\N	\N	\N	\N	\N	0	\N
cmmnc5uxr0011a885xkzn4zw2	DRAFT	cmmnc5uxk000ya885q6516wws	225-000-114-785	AKA	CLIENT_PRIVILEGIE	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-12 10:39:32.319	2026-03-12 10:39:32.319	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmin2hwc0003fzqtom2f5et1	PAID	cmmin2hw30000fzqtyy0dsyje	114-555-222-588	Desnoces	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.303	0.350	65500	0	65500	Bonjour Desnoces,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 24578521\nNuméro FBO : 114-555-222-588\nMontant à payer : 65 500 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_ZrAm1TUmbL\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	24578521	+2250506025071	2026-03-09 03:46:00.349	2026-03-09 03:48:12.356	2026-03-09 03:46:14.753	2026-03-09 03:48:12.353	\N	\N	\N	\N	\N	\N	\N	2026-03-09 03:46:59.244	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_ZrAm1TUmbL	\N	\N	test_ZrAm1TUmbL	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-09 03:48:12.353	\N	\N	cmmin3rbz000lfzqtkzsw9qz1	SENT	2026-03-09 03:46:59.244	0	\N
cmmjb494e0003xm3tbt47lghg	READY	cmmjb49440000xm3t4qcf1exu	225-000-129-990	Alla Blondeau sosthene	MANAGER	ABIDJAN	WAVE	LIVRAISON	0.300	3.000	66000	2000	68000	Bonjour Alla Blondeau sosthene,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 27302\nNuméro FBO : 225-000-129-990\nMontant à payer : 68 000 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_Y1WF00nLXR\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	27302	+2250506025071	2026-03-09 14:59:13.07	2026-03-09 15:12:41.962	2026-03-09 15:00:33.684	2026-03-09 15:05:20.464	\N	\N	\N	\N	\N	\N	\N	2026-03-09 15:02:04.65	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_Y1WF00nLXR	\N	\N	test_Y1WF00nLXR	PAYDUNYA_WEBHOOK	2026-03-09 15:12:41.953	admin@forever.ci	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	\N	2026-03-09 15:05:20.464	2026-03-09 15:12:41.953	\N	cmmjb7xi80015xm3tbb4h311a	SENT	2026-03-09 15:02:04.65	0	\N
cmmfm1ecx0003hab80o5vuce4	PAID	cmmfm1eco0000hab8gbq6m4bf	225-000-111-444	FELIX ANDRE	CLIENT_PRIVILEGIE	ABIDJAN	ORANGE_MONEY	RETRAIT_SITE_FLP	0.303	0.350	65500	0	65500	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmfm1ecx0003hab80o5vuce4\nFBO: 225-000-111-444\nNom: FELIX ANDRE\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: ORANGE_MONEY\n\n Produits demandé :\n- x 1 | SKU: 504 | Forever ARGI+ Sticks pack | 65500 FCFA | 0.303 CC\n\n Totaux:\nProduits: 65500 FCFA\nLivraison: 0 FCFA\nGLOBAL: 65500 FCFA	225874895	+2250506025071	2026-03-07 00:53:50.962	2026-03-07 00:56:28.465	2026-03-07 00:54:18.109	2026-03-07 00:56:28.464	\N	\N	\N	\N	\N	\N	\N	2026-03-07 00:55:51.993	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_w24XRgIkWb	\N	\N	test_w24XRgIkWb	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-07 00:56:28.464	\N	\N	\N	\N	\N	0	\N
cmmi1dg2x00063na6mjc3tcju	READY	cmmi1dg2n00033na6kdr3ywre	225-000-852-665	SORE Claude	ANIMATEUR_ADJOINT	ABIDJAN	ORANGE_MONEY	RETRAIT_SITE_FLP	0.435	1.425	95000	0	95000	Bonjour SORE Claude,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 254145\nNuméro FBO : 225-000-852-665\nMontant à payer : 95 000 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_94NEdllZPw\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	254145	+2250506025071	2026-03-08 17:38:39.657	2026-03-08 17:44:39.209	2026-03-08 17:39:23.388	2026-03-08 17:42:44.361	\N	\N	\N	\N	\N	\N	\N	2026-03-08 17:40:46.205	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_94NEdllZPw	\N	\N	test_94NEdllZPw	PAYDUNYA_WEBHOOK	2026-03-08 17:44:39.166	admin@forever.ci	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	\N	2026-03-08 17:42:44.361	2026-03-08 17:44:39.166	\N	\N	\N	\N	0	\N
cmmkqosja00035ihu0tbq9luy	DRAFT	cmmkqosj100005ihug3dc1gq7	225-000-324-365	REBECCA	ANIMATEUR_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 15:02:51.766	2026-03-10 15:02:51.766	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	cmmjcsh6h0000beh1qkkqeruu	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmnc6nq40017a885lodpzsoz	SUBMITTED	cmmnc6npx0014a885yw881qxw	222-585-222-364	AKA	ANIMATEUR_ADJOINT	ABIDJAN	WAVE	RETRAIT_SITE_FLP	1.066	4.000	161700	0	161700	- PRÉCOMMANDE FLP CIV -\nPrécommande N° : cmmnc6nq40017a885lodpzsoz\nFBO : 222-585-222-364\nNom : AKA\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : WAVE\n\nProduits demandés :\n- x 2 | SKU: 659 | DX4 | 161 700 FCFA | 1.066 CC\n\nTotaux :\nProduits : 161 700 FCFA\nLivraison : 0 FCFA\nGLOBAL : 161 700 FCFA	\N	+2250506025071	2026-03-12 10:40:09.628	2026-03-12 10:54:34.257	2026-03-12 10:54:34.253	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkyoi8n000d4fmmlfjumyhp	DRAFT	cmmkyoi8a000a4fmm2iuxhdk2	226-000-123-432	SANOU KEVIN	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 18:46:35.351	2026-03-10 18:46:35.351	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmm1k0830014hxjg53foxruc	FULFILLED	cmmm1k07w0011hxjg6ort8bdj	225-000-145-677	KONAN CEDRIC	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.256	1.230	50850	0	50850	Bonjour KONAN CEDRIC,\n\nVotre précommande FOREVER a bien été enregistrée et votre préfacture est prête.\n\nRéférence : 2454670\nNuméro FBO : 225-000-145-677\nMontant à payer : 50 850 FCFA\n\nVeuillez finaliser votre paiement en cliquant sur le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_sWbMHiDuzV\n\nUne fois le paiement confirmé, votre commande sera préparée.\n\nMerci.\nFOREVER	2454670	+2250506025071	2026-03-11 12:54:50.403	2026-03-11 13:03:42.158	2026-03-11 12:55:35.459	2026-03-11 13:00:09.505	\N	\N	\N	\N	2026-03-11 13:03:42.158	admin@forever.ci	\N	2026-03-11 12:57:21.43	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_sWbMHiDuzV	\N	\N	test_sWbMHiDuzV	PAYDUNYA_WEBHOOK	2026-03-11 13:02:27.896	admin@forever.ci	\N	\N	country_ci_default	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	\N	2026-03-11 13:00:09.505	2026-03-11 13:02:27.896	\N	cmmm1n8r1002ahxjgwrqevv67	SENT	2026-03-11 12:57:21.43	0	\N
cmmii5rad0003qjcwgitocdhs	DRAFT	cmmii5ra50000qjcwhy1czhoz	225-000-858-741	MARC	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.507	1.584	109500	0	109500	\N	\N	\N	2026-03-09 01:28:34.405	2026-03-09 01:29:00.192	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmfjzbbm0003qpo561nxmp9r	DRAFT	cmmfjzb9p0000qpo58d87dj8s	226-457-145-789	BROU KONAN	ANIMATEUR	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.274	0.150	54000	0	54000	\N	\N	\N	2026-03-06 23:56:14.482	2026-03-06 23:56:56.263	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmndbomy0003d4k8v76jcn1w	DRAFT	cmmndbomp0000d4k8gd6kcjy4	225-000-114-526	Isaac SEMILOI	CLIENT_PRIVILEGIE	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.269	0.132	54625	0	54625	\N	\N	\N	2026-03-12 11:12:03.706	2026-03-12 11:12:54.543	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmfo45tf00038184xc8tfvxp	PAID	cmmfo45t700008184kayjg7wi	228-000-145-784	BANCE OUSMANE	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.308	1.096	68000	0	68000	Bonjour BANCE OUSMANE,\n\nVotre précommande FOREVER a été validée.\n\nRéférence : PF202623541\nNuméro FBO : 228-000-145-784\nMontant à payer : 68 000 FCFA\n\nVeuillez finaliser votre paiement via le lien ci-dessous :\nhttps://paydunya.com/sandbox-checkout/invoice/test_YwF4Bm4b0i\n\nMerci.\nFOREVER	PF202623541	+2250506025071	2026-03-07 01:51:59.092	2026-03-07 01:55:54.216	2026-03-07 01:52:43.071	2026-03-07 01:55:54.215	\N	\N	\N	\N	\N	\N	\N	2026-03-07 01:53:25.065	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_YwF4Bm4b0i	\N	\N	test_YwF4Bm4b0i	PAYDUNYA_WEBHOOK	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	\N	\N	\N	2026-03-07 01:55:54.215	\N	\N	\N	\N	\N	0	\N
cmmgavqa7000t2izzjm1r0bam	PAID	cmmgavqa0000q2izzbu3zwlrv	225-008-745-236	Kra Kouadio	MANAGER_ADJOINT	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.533	2.000	115500	0	115500	Bonjour Kra Kouadio,\n\nVotre précommande FOREVER a bien été enregistrée et votre facture est prête.\n\nRéférence : 254153\nNuméro FBO : 225-008-745-236\nMontant à payer : 115 500 FCFA\n\nMerci de vous présenter au bureau pour effectuer le règlement en espèces.\nVotre commande sera préparée après validation du paiement.\n\nMerci.\nFOREVER	254153	+2250506025071	2026-03-07 12:29:16.88	2026-03-08 07:06:13.66	2026-03-07 12:30:43.475	2026-03-08 07:06:13.658	\N	\N	\N	\N	\N	\N	115500	2026-03-08 07:04:55.212	admin@forever.ci	\N	\N	\N	\N	\N	admin@forever.ci	\N	\N	\N	\N	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	\N	2026-03-08 07:06:13.658	\N	\N	\N	\N	\N	0	\N
cmmewbw5e000310p8xl7c5h0j	FULFILLED	cmmewbw4z000010p8e0wudsfg	225-000-145-746	INZA FOFANA	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.196	1.200	39150	0	39150	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmewbw5e000310p8xl7c5h0j\nFBO: 225-000-145-746\nNom: INZA FOFANA\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: ESPECES\n\n Produits demandé :\n- x1 34 Aloe Berry Nectar | 19800 FCFA | 0.1 CC\n- x1 284 Aloe Avocado Face & Body Soap | 5850 FCFA | 0.027 CC\n- x1 48 Absorbent-C | 13500 FCFA | 0.069 CC\n\n Totaux:\nProduits: 39150 FCFA\nLivraison: 0 FCFA\nGLOBAL: 39150 FCFA	745862	+2250506025071	2026-03-06 12:54:10.562	2026-03-06 13:01:36.347	2026-03-06 12:54:31.896	2026-03-06 12:56:29.39	\N	\N	\N	\N	2026-03-06 13:01:36.346	admin@forever.ci	39150	2026-03-06 12:56:03.063	admin@forever.ci	- x1 34 Aloe Berry Nectar\n- x1 284 Aloe Avocado Face & Body Soap\n- x1 48 Absorbent-C	\N	\N	\N	\N	admin@forever.ci	2026-03-06 12:59:50.473	admin@forever.ci	\N	\N	country_ci_default	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	2026-03-06 12:56:29.39	2026-03-06 12:59:50.473	\N	\N	\N	\N	0	\N
cmmeycnbp0013co9dtixvuaxo	SUBMITTED	cmmeycnbe0010co9d2k9gphn9	222-525-457-547	AKA JOEL	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	1.036	2.382	201150	0	201150	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmeycnbp0013co9dtixvuaxo\nFBO: 222-525-457-547\nNom: AKA JOEL\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: ESPECES\n\n Produits demandé :\n- x1 504 Forever ARGI+ Sticks pack | 58950 FCFA | 0.303 CC\n- x1 686 Forerver Vitamine C | 38250 FCFA | 0.2 CC\n- x1 659 DX4 | 103950 FCFA | 0.533 CC\n\n Totaux:\nProduits: 201150 FCFA\nLivraison: 0 FCFA\nGLOBAL: 201150 FCFA	\N	+2250506025071	2026-03-06 13:50:45.013	2026-03-06 13:51:07.579	2026-03-06 13:51:07.578	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmeybkad0003co9dkeura5q4	DRAFT	cmmeybka50000co9dggwuf0lz	225-114-588-445	AKA JOEL	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.350	2.500	69750	0	69750	\N	\N	\N	2026-03-06 13:49:54.421	2026-03-06 13:50:20.248	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmfk13uc000qqpo5xz9ldsor	PAID	cmmfk13u4000nqpo5rre2f569	225-000-145-236	BROU KONAN MARCELIN	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.200	2.000	44000	0	44000	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmfk13uc000qqpo5xz9ldsor\nFBO: 225-000-145-236\nNom: BROU KONAN MARCELIN\nMode de livraison: RETRAIT_SITE_FLP\nMode de Paiement: WAVE\n\n Produits demandé :\n- x 1 | SKU: 34 | Aloe Berry Nectar | 22000 FCFA | 0.1 CC\n- x 1 | SKU: 77 | Coeur d'Aloes | 22000 FCFA | 0.1 CC\n\n Totaux:\nProduits: 44000 FCFA\nLivraison: 0 FCFA\nGLOBAL: 44000 FCFA	41256278	+2250506025071	2026-03-06 23:57:38.1	2026-03-07 00:12:37.269	2026-03-06 23:58:08.816	2026-03-07 00:12:37.266	\N	\N	\N	\N	\N	\N	\N	2026-03-06 23:59:23.616	admin@forever.ci	\N	https://paydunya.com/sandbox-checkout/invoice/test_IeKaxSfv9U	\N	\N	test_IeKaxSfv9U	admin@forever.ci	\N	\N	2026-03-07 00:01:50.502	admin@forever.ci	country_ci_default	\N	\N	cmmc6gfhs00014nxc479niy5h	cmmc6gfhs00014nxc479niy5h	\N	cmmc6gfhs00014nxc479niy5h	2026-03-07 00:12:37.266	\N	\N	\N	\N	\N	0	\N
cmmjifs74000370gmb4ysyc2h	DRAFT	cmmjifs6t000070gmlapg8lag	225-443-233-345	KRA	MANAGER	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-09 18:24:08.32	2026-03-09 18:24:08.32	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	cmmjcsh6h0000beh1qkkqeruu	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkqw4mt00095ihubgi7ul0z	DRAFT	cmmkqw4mm00065ihucof95z6s	225-000-066-453	REBECCA	ANIMATEUR_ADJOINT	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.000	0.000	0	0	0	\N	\N	\N	2026-03-10 15:08:34.037	2026-03-10 15:08:34.037	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	cmmjcsh6h0000beh1qkkqeruu	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmmkrhq11002f5ihuu24uq0c1	SUBMITTED	cmmkrhq0u002c5ihul9pswmmu	225-000-254-147	Raoul	MANAGER	ABIDJAN	WAVE	RETRAIT_SITE_FLP	0.667	1.007	145500	0	145500	- PRÉCOMMANDE FLP CI -\nPrécommande N° : cmmkrhq11002f5ihuu24uq0c1\nFBO : 225-000-254-147\nNom : Raoul\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : WAVE\n\nProduits demandés :\n- x 1 | SKU: 71 | Garcinia Plus | 26 000 FCFA | 0.12 CC\n- x 1 | SKU: 289 | Forever Lean | 36 500 FCFA | 0.167 CC\n- x 1 | SKU: 463 | Forever Therm | 25 000 FCFA | 0.114 CC\n- x 1 | SKU: 470 | Forever Lite Ultra Vanille | 26 500 FCFA | 0.123 CC\n- x 1 | SKU: 471 | Forever Lite Ultra Chocolat | 26 500 FCFA | 0.122 CC\n- x 1 | SKU: 520 | Forever Fast Break Bar | 5 000 FCFA | 0.021 CC\n\nTotaux :\nProduits : 145 500 FCFA\nLivraison : 0 FCFA\nGLOBAL : 145 500 FCFA	\N	+2250506025071	2026-03-10 15:25:21.542	2026-03-10 15:26:33.786	2026-03-10 15:26:33.786	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
cmml67lwu0003nfmehe75h6mp	SUBMITTED	cmml67lvn0000nfmeb32io2k4	226-147-852-963	KOUAKOU	ANIMATEUR	ABIDJAN	ESPECES	RETRAIT_SITE_FLP	0.246	2.000	48600	0	48600	- PRÉCOMMANDE FLP CIV -\nPrécommande N° : cmml67lwu0003nfmehe75h6mp\nFBO : 226-147-852-963\nNom : KOUAKOU\nMode de livraison : RETRAIT_SITE_FLP\nMode de paiement : ESPECES\n\nProduits demandés :\n- x 1 | SKU: 196 | Forever Freedom | 28 800 FCFA | 0.146 CC\n- x 1 | SKU: 15 | Pulpe - Aloe Vera Gel - 1L | 19 800 FCFA | 0.1 CC\n\nTotaux :\nProduits : 48 600 FCFA\nLivraison : 0 FCFA\nGLOBAL : 48 600 FCFA	\N	+2250506025071	2026-03-10 22:17:23.886	2026-03-10 22:38:50.932	2026-03-10 22:38:50.931	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	country_ci_default	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	0	\N
\.


--
-- Data for Name: PreorderItem; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."PreorderItem" (id, "preorderId", "productId", qty, "prixUnitaireFcfa", "ccUnitaire", "poidsUnitaireKg", "lineTotalFcfa", "lineTotalCc", "lineTotalPoids", "createdAt", "updatedAt", "discountPercent", "prixCatalogueFcfa", "productNameSnapshot", "productSkuSnapshot") FROM stdin;
cmmewc9ep000v10p857x2324b	cmmewbw5e000310p8xl7c5h0j	cmls3i2ka000c6gu5r0tuvg0x	1	19800	0.100	1.000	19800	0.100	1.000	2026-03-06 12:54:27.745	2026-03-06 12:54:31.89	10.00	22000	Aloe Berry Nectar	34
cmmewc9ep000w10p8nn4slkni	cmmewbw5e000310p8xl7c5h0j	cmls41vj0000o6gu5hlxu9pyq	1	5850	0.027	0.100	5850	0.027	0.100	2026-03-06 12:54:27.745	2026-03-06 12:54:31.893	10.00	6500	Aloe Avocado Face & Body Soap	284
cmmewc9ep000x10p8ahhi44zo	cmmewbw5e000310p8xl7c5h0j	cmls4fhxp00176gu5u13bgf1m	1	13500	0.069	0.100	13500	0.069	0.100	2026-03-06 12:54:27.745	2026-03-06 12:54:31.895	10.00	15000	Absorbent-C	48
cmmg0i4hy000xx32gvxt0fuwi	cmmg0hgmb0003x32gpt92ynd1	cmls4fhxp00176gu5u13bgf1m	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:38:45.959	2026-03-07 07:38:45.959	0.00	0	\N	\N
cmmg0i4hy000yx32guvd2xkpj	cmmg0hgmb0003x32gpt92ynd1	cmls41vj0000o6gu5hlxu9pyq	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:38:45.959	2026-03-07 07:38:45.959	0.00	0	\N	\N
cmmg0i4hy000zx32gz2w6y2qb	cmmg0hgmb0003x32gpt92ynd1	cmmdgrtsp0001ly5t5patyv1v	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:38:45.959	2026-03-07 07:38:45.959	0.00	0	\N	\N
cmmeyc47a000wco9dpufwxgmb	cmmeybkad0003co9dkeura5q4	cmm3gzb13000013oe3tfxqopm	5	0	0.000	0.000	0	0.000	0.000	2026-03-06 13:50:20.23	2026-03-06 13:50:20.23	0.00	0	\N	\N
cmmg0i4hy0010x32gyo3bwzhh	cmmg0hgmb0003x32gpt92ynd1	cmls4ot9e00196gu5susrhq13	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:38:45.959	2026-03-07 07:38:45.959	0.00	0	\N	\N
cmmeyd061001pco9dfn2o66s5	cmmeycnbp0013co9dtixvuaxo	cmls2milw00006gu58tacyuar	1	58950	0.303	0.350	58950	0.303	0.350	2026-03-06 13:51:01.658	2026-03-06 13:51:07.572	10.00	65500	Forever ARGI+ Sticks pack	504
cmmeyd061001qco9d3z3x40ly	cmmeycnbp0013co9dtixvuaxo	cmm72tmhn0005zax6saur1hb3	1	38250	0.200	0.032	38250	0.200	0.032	2026-03-06 13:51:01.658	2026-03-06 13:51:07.575	10.00	42500	Forerver Vitamine C	686
cmmeyd061001rco9d8rkxyd42	cmmeycnbp0013co9dtixvuaxo	cmm7l59n80000ms2kgsiklkiz	1	103950	0.533	2.000	103950	0.533	2.000	2026-03-06 13:51:01.658	2026-03-06 13:51:07.577	10.00	115500	DX4	659
cmmeysqxx002pco9d244wnk9i	cmmeysa160021co9docxg9cg7	cmls4fhxp00176gu5u13bgf1m	9	0	0.000	0.000	0	0.000	0.000	2026-03-06 14:03:16.198	2026-03-06 14:03:16.198	0.00	0	\N	\N
cmmg0k3lk0021x32gty508cnd	cmmg0jmum0017x32gyuzpcvrm	cmls4fhxp00176gu5u13bgf1m	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:40:18.105	2026-03-07 07:40:18.105	0.00	0	\N	\N
cmmg0k3lk0022x32g99iwwsk6	cmmg0jmum0017x32gyuzpcvrm	cmls41vj0000o6gu5hlxu9pyq	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:40:18.105	2026-03-07 07:40:18.105	0.00	0	\N	\N
cmmeyu20c003fco9dkp7l4n3b	cmmeytpkk002wco9dongbaxj8	cmls4fhxp00176gu5u13bgf1m	10	15000	0.069	0.100	150000	0.690	1.000	2026-03-06 14:04:17.197	2026-03-06 14:04:23.061	0.00	15000	Absorbent-C	48
cmmg0k3lk0023x32gbv2ldtyq	cmmg0jmum0017x32gyuzpcvrm	cmls4ot9e00196gu5susrhq13	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:40:18.105	2026-03-07 07:40:18.105	0.00	0	\N	\N
cmmg0k3lk0024x32gu8j8nic7	cmmg0jmum0017x32gyuzpcvrm	cmls3i2ka000c6gu5r0tuvg0x	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 07:40:18.105	2026-03-07 07:40:18.105	0.00	0	\N	\N
cmmez9z6k004uco9dgm48lpl2	cmmez9gq90046co9dwndbxn2d	cmls3i2ka000c6gu5r0tuvg0x	4	22000	0.100	1.000	88000	0.400	4.000	2026-03-06 14:16:40.028	2026-03-06 14:16:45.898	0.00	22000	Aloe Berry Nectar	34
cmmfi0its000iph8f591jjkde	cmmfhzsb40003ph8fdm5yzh9u	cmmdgrtsp0001ly5t5patyv1v	1	14400	0.072	0.040	14400	0.072	0.040	2026-03-06 23:01:11.632	2026-03-06 23:01:17.926	10.00	16000	Forever Ail et Thym	65
cmmfi0its000jph8f2v1967cx	cmmfhzsb40003ph8fdm5yzh9u	cmmdgxa760003ly5tmy7b2m6c	1	23400	0.120	0.080	23400	0.120	0.080	2026-03-06 23:01:11.632	2026-03-06 23:01:17.958	10.00	26000	Forever Artic Sea	376
cmmfk07jr000iqpo58k7hqvsp	cmmfjzbbm0003qpo561nxmp9r	cmlskghjo0001xe143p8q80fd	1	0	0.000	0.000	0	0.000	0.000	2026-03-06 23:56:56.248	2026-03-06 23:56:56.248	0.00	0	\N	\N
cmmfk07jr000jqpo5mr18c1ls	cmmfjzbbm0003qpo561nxmp9r	cmm2aajt70000ie0ay4rcf48m	1	0	0.000	0.000	0	0.000	0.000	2026-03-06 23:56:56.248	2026-03-06 23:56:56.248	0.00	0	\N	\N
cmmfk1l6b0015qpo574mvgxq0	cmmfk13uc000qqpo5xz9ldsor	cmls3i2ka000c6gu5r0tuvg0x	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-06 23:58:00.563	2026-03-06 23:58:08.811	0.00	22000	Aloe Berry Nectar	34
cmmfk1l6b0016qpo57a82c3p7	cmmfk13uc000qqpo5xz9ldsor	cmm3s6a9300002efo256oiqls	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-06 23:58:00.563	2026-03-06 23:58:08.815	0.00	22000	Coeur d'Aloes	77
cmmfkqgnn000oobosvluxmxua	cmmfkq2pz0003obosmskoczag	cmls4fhxp00176gu5u13bgf1m	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 00:17:21.108	2026-03-07 00:17:21.108	0.00	0	\N	\N
cmmfkqgnn000pobosp6o2fccg	cmmfkq2pz0003obosmskoczag	cmls3i2ka000c6gu5r0tuvg0x	1	0	0.000	0.000	0	0.000	0.000	2026-03-07 00:17:21.108	2026-03-07 00:17:21.108	0.00	0	\N	\N
cmmfkrigh001bobose2um9fiu	cmmfkr9bx000wobosmgo8zsa0	cmls3i2ka000c6gu5r0tuvg0x	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-07 00:18:10.098	2026-03-07 00:18:17.274	0.00	22000	Aloe Berry Nectar	34
cmmfkrigh001cobos3n0jv6zp	cmmfkr9bx000wobosmgo8zsa0	cmls4fhxp00176gu5u13bgf1m	1	15000	0.069	0.100	15000	0.069	0.100	2026-03-07 00:18:10.098	2026-03-07 00:18:17.277	0.00	15000	Absorbent-C	48
cmmfm1pvm000chab89yxcg4n9	cmmfm1ecx0003hab80o5vuce4	cmls2milw00006gu58tacyuar	1	65500	0.303	0.350	65500	0.303	0.350	2026-03-07 00:54:05.891	2026-03-07 00:54:18.105	0.00	65500	Forever ARGI+ Sticks pack	504
cmmg0lpcc003ex32g5m57zmn4	cmmg0l7v8002bx32gq137c276	cmls3i2ka000c6gu5r0tuvg0x	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-07 07:41:32.94	2026-03-07 07:41:40.279	0.00	22000	Aloe Berry Nectar	34
cmmg0lpcc003fx32gd83tgw96	cmmg0l7v8002bx32gq137c276	cmls4ot9e00196gu5susrhq13	1	13000	0.060	0.030	13000	0.060	0.030	2026-03-07 07:41:32.94	2026-03-07 07:41:40.282	0.00	13000	Aloe Heat Lotion	564
cmmg0lpcc003gx32gx5kl4iv0	cmmg0l7v8002bx32gq137c276	cmm3s6a9300002efo256oiqls	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-07 07:41:32.94	2026-03-07 07:41:40.284	0.00	22000	Coeur d'Aloes	77
cmmg0lpcc003hx32g6qkvs3ei	cmmg0l7v8002bx32gq137c276	cmls41vj0000o6gu5hlxu9pyq	1	6500	0.027	0.100	6500	0.027	0.100	2026-03-07 07:41:32.94	2026-03-07 07:41:40.286	0.00	6500	Aloe Avocado Face & Body Soap	284
cmmg0lpcc003ix32g6v6j5z56	cmmg0l7v8002bx32gq137c276	cmls4fhxp00176gu5u13bgf1m	1	15000	0.069	0.100	15000	0.069	0.100	2026-03-07 07:41:32.94	2026-03-07 07:41:40.289	0.00	15000	Absorbent-C	48
cmmfo4vqd000w8184mg3wasec	cmmfo45tf00038184xc8tfvxp	cmm72tmhn0005zax6saur1hb3	1	42500	0.200	0.032	42500	0.200	0.032	2026-03-07 01:52:32.678	2026-03-07 01:52:43.066	0.00	42500	Forerver Vitamine C	686
cmmfo4vqd000x8184v749j3ir	cmmfo45tf00038184xc8tfvxp	cmm3gzb13000013oe3tfxqopm	1	15500	0.070	0.500	15500	0.070	0.500	2026-03-07 01:52:32.678	2026-03-07 01:52:43.069	0.00	15500	Forever Bee Honey	207
cmmfo4vqd000y8184dw0v88qz	cmmfo45tf00038184xc8tfvxp	cmls3r44r000d6gu58mrzo3rg	2	5000	0.019	0.282	10000	0.038	0.564	2026-03-07 01:52:32.678	2026-03-07 01:52:43.07	0.00	5000	FAB - Forever Active Boost	721
cmmg80b3x001ilmbsfkhfx7qz	cmmg7wqzu0003lmbsvydsd79u	cmls4fhxp00176gu5u13bgf1m	1	15000	0.069	0.100	15000	0.069	0.100	2026-03-07 11:08:51.646	2026-03-07 11:09:13.352	0.00	15000	Absorbent-C	48
cmmg80b3x001jlmbsszxlb8qf	cmmg7wqzu0003lmbsvydsd79u	cmls41vj0000o6gu5hlxu9pyq	1	6500	0.027	0.100	6500	0.027	0.100	2026-03-07 11:08:51.646	2026-03-07 11:09:13.356	0.00	6500	Aloe Avocado Face & Body Soap	284
cmmg80b3x001klmbsfnlm6hcr	cmmg7wqzu0003lmbsvydsd79u	cmls3i2ka000c6gu5r0tuvg0x	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-07 11:08:51.646	2026-03-07 11:09:13.359	0.00	22000	Aloe Berry Nectar	34
cmmgao4el000i2izzug4syumv	cmmgannw700032izzvgvklsa7	cmls3i2ka000c6gu5r0tuvg0x	1	19800	0.100	1.000	19800	0.100	1.000	2026-03-07 12:23:21.934	2026-03-07 12:23:48.74	10.00	22000	Aloe Berry Nectar	34
cmmgao4el000j2izzhmb3r7kk	cmmgannw700032izzvgvklsa7	cmm3s6a9300002efo256oiqls	1	19800	0.100	1.000	19800	0.100	1.000	2026-03-07 12:23:21.934	2026-03-07 12:23:48.744	10.00	22000	Coeur d'Aloes	77
cmmgavxby00122izzps44s96m	cmmgavqa7000t2izzjm1r0bam	cmm7l59n80000ms2kgsiklkiz	1	115500	0.533	2.000	115500	0.533	2.000	2026-03-07 12:29:26.015	2026-03-07 12:30:43.471	0.00	115500	DX4	659
cmmgr1gos000ing16mydinss4	cmmgr128g0003ng164v3p631u	cmm72tmhn0005zax6saur1hb3	1	38250	0.200	0.032	38250	0.200	0.032	2026-03-07 20:01:38.236	2026-03-07 20:01:46.517	10.00	42500	Forerver Vitamine C	686
cmmgr1gos000jng16oszw4co6	cmmgr128g0003ng164v3p631u	cmmdgrtsp0001ly5t5patyv1v	1	14400	0.072	0.040	14400	0.072	0.040	2026-03-07 20:01:38.236	2026-03-07 20:01:46.52	10.00	16000	Forever Ail et Thym	65
cmmhf7tz0000ym988cubns493	cmmhf7dv4000cm988xspalpqy	cmls2milw00006gu58tacyuar	1	65500	0.303	0.350	65500	0.303	0.350	2026-03-08 07:18:26.172	2026-03-08 07:18:37.482	0.00	65500	Forever ARGI+ Sticks pack	504
cmmhf7tz0000zm988tzckeer7	cmmhf7dv4000cm988xspalpqy	cmm3gzb13000013oe3tfxqopm	1	15500	0.070	0.500	15500	0.070	0.500	2026-03-08 07:18:26.172	2026-03-08 07:18:37.485	0.00	15500	Forever Bee Honey	207
cmmhf7tz00010m988m1bkm36r	cmmhf7dv4000cm988xspalpqy	cmm4gzxqr000313nmlz6wd73f	1	28480	0.130	0.043	28480	0.130	0.043	2026-03-08 07:18:26.172	2026-03-08 07:18:37.487	0.00	28480	Forever Bee Propolis	27
cmmj4evvw000p10c2jg9470lq	cmmj4dnuz000310c22dko6wk9	cmls3r44r000d6gu58mrzo3rg	1	5000	0.019	0.282	5000	0.019	0.282	2026-03-09 11:51:31.82	2026-03-09 12:03:28.871	0.00	5000	FAB - Forever Active Boost	721
cmmj4evvw000r10c22go0bj1f	cmmj4dnuz000310c22dko6wk9	cmls4ot9e00196gu5susrhq13	1	13000	0.060	0.030	13000	0.060	0.030	2026-03-09 11:51:31.82	2026-03-09 12:03:28.874	0.00	13000	Aloe Heat Lotion	564
cmmj4evvw000q10c2l004dqv3	cmmj4dnuz000310c22dko6wk9	cmm3s6a9300002efo256oiqls	1	22000	0.100	1.000	22000	0.100	1.000	2026-03-09 11:51:31.82	2026-03-09 12:03:28.877	0.00	22000	Coeur d'Aloes	77
cmmjb5os7000wxm3tk4aer9p0	cmmjb494e0003xm3tbt47lghg	cmls3i2ka000c6gu5r0tuvg0x	3	22000	0.100	1.000	66000	0.300	3.000	2026-03-09 15:00:20.024	2026-03-09 15:00:33.682	0.00	22000	Aloe Berry Nectar	34
cmmi1e70t00173na64pf2ma9w	cmmi1dg2x00063na6mjc3tcju	cmls38zg300046gu59fpffhug	1	32000	0.146	1.000	32000	0.146	1.000	2026-03-08 17:39:14.573	2026-03-08 17:39:23.379	0.00	32000	Forever Freedom	196
cmmi1e70t00183na6c4gjhuy1	cmmi1dg2x00063na6mjc3tcju	cmm4fmlxz000113nm2tqerc8d	1	26500	0.122	0.375	26500	0.122	0.375	2026-03-08 17:39:14.573	2026-03-08 17:39:23.385	0.00	26500	Forever Lite Ultra Chocolat	471
cmmi1e70t00193na6pg7t7te3	cmmi1dg2x00063na6mjc3tcju	cmlskghjo0001xe143p8q80fd	1	36500	0.167	0.050	36500	0.167	0.050	2026-03-08 17:39:14.573	2026-03-08 17:39:23.387	0.00	36500	Forever Lean	289
cmmkraeqk000o5ihujonrhk23	cmmkra2lh000f5ihu7lynpaty	cmm7l59n80000ms2kgsiklkiz	1	103950	0.533	2.000	103950	0.533	2.000	2026-03-10 15:19:40.317	2026-03-10 15:19:52.952	10.00	115500	DX4	659
cmmii6b5z0016qjcwsr6dp2s9	cmmii5rad0003qjcwgitocdhs	cmls3z93h000n6gu5snuggrfj	1	0	0.000	0.000	0	0.000	0.000	2026-03-09 01:29:00.167	2026-03-09 01:29:00.167	0.00	0	\N	\N
cmmii6b5z0017qjcwij5uwshh	cmmii5rad0003qjcwgitocdhs	cmls3x9x5000m6gu5k6l06mvb	1	0	0.000	0.000	0	0.000	0.000	2026-03-09 01:29:00.167	2026-03-09 01:29:00.167	0.00	0	\N	\N
cmmii6b5z0018qjcw8gc0nyth	cmmii5rad0003qjcwgitocdhs	cmm3sfz5l00012efon35ckxa9	1	0	0.000	0.000	0	0.000	0.000	2026-03-09 01:29:00.167	2026-03-09 01:29:00.167	0.00	0	\N	\N
cmmii6b5z0019qjcwqfdlhkfn	cmmii5rad0003qjcwgitocdhs	cmls3gfzc000b6gu5o4loeinr	1	0	0.000	0.000	0	0.000	0.000	2026-03-09 01:29:00.167	2026-03-09 01:29:00.167	0.00	0	\N	\N
cmmii6b5z001aqjcwpuaam2zh	cmmii5rad0003qjcwgitocdhs	cmm4h43xy000413nmluqqbwmt	1	0	0.000	0.000	0	0.000	0.000	2026-03-09 01:29:00.167	2026-03-09 01:29:00.167	0.00	0	\N	\N
cmmkrgi5x00235ihukc47f2c2	cmmkrfi2w000y5ihut1oggkt9	cmls41vj0000o6gu5hlxu9pyq	1	5850	0.027	0.100	5850	0.027	0.100	2026-03-10 15:24:24.693	2026-03-10 15:24:33.111	10.00	6500	Aloe Avocado Face & Body Soap	284
cmmiib919002bqjcw7jxoetw0	cmmiiauuu001hqjcwxgyvmewh	cmm3gzb13000013oe3tfxqopm	1	13950	0.070	0.500	13950	0.070	0.500	2026-03-09 01:32:50.685	2026-03-09 01:51:16.19	10.00	15500	Forever Bee Honey	207
cmmiib9190029qjcwyzbn5uz6	cmmiiauuu001hqjcwxgyvmewh	cmm4hb1nb000513nm1ckwxdga	1	11700	0.060	0.060	11700	0.060	0.060	2026-03-09 01:32:50.685	2026-03-09 01:51:16.198	10.00	13000	Forever Bee Pollen	26
cmmiib919002aqjcwwerjyjun	cmmiiauuu001hqjcwxgyvmewh	cmmdgxa760003ly5tmy7b2m6c	1	23400	0.120	0.080	23400	0.120	0.080	2026-03-09 01:32:50.685	2026-03-09 01:51:16.2	10.00	26000	Forever Artic Sea	376
cmmkrgi5x00225ihu4kjhaddp	cmmkrfi2w000y5ihut1oggkt9	cmls45cyx000p6gu5zmxsbrs8	1	6300	0.032	0.050	6300	0.032	0.050	2026-03-10 15:24:24.693	2026-03-10 15:24:33.115	10.00	7000	Forever Bright	28
cmmkrgi5x00215ihu2aym7ocg	cmmkrfi2w000y5ihut1oggkt9	cmls4ot9e00196gu5susrhq13	1	11700	0.060	0.030	11700	0.060	0.030	2026-03-10 15:24:24.693	2026-03-10 15:24:33.12	10.00	13000	Aloe Heat Lotion	564
cmmkrgi5x00245ihu4g4xzdsg	cmmkrfi2w000y5ihut1oggkt9	cmm2aq7af0003ie0a12ckessh	1	14400	0.059	0.100	14400	0.059	0.100	2026-03-10 15:24:24.693	2026-03-10 15:24:33.123	10.00	16000	Gelée Aloès - Aloe Verra Gelly	61
cmmikvq6h000s4o4awbdyn5bl	cmmikvfui000d4o4apwj0j5o4	cmls3z93h000n6gu5snuggrfj	1	26000	0.127	0.100	26000	0.127	0.100	2026-03-09 02:44:45.257	2026-03-09 02:44:51.85	0.00	26000	Vitolize Women	375
cmmikvq6h000t4o4a459232bx	cmmikvfui000d4o4apwj0j5o4	cmls3x9x5000m6gu5k6l06mvb	1	26000	0.120	0.100	26000	0.120	0.100	2026-03-09 02:44:45.257	2026-03-09 02:44:51.854	0.00	26000	Vitolize Men	374
cmmin2po7000cfzqtz0brxao1	cmmin2hwc0003fzqtom2f5et1	cmls2milw00006gu58tacyuar	1	65500	0.303	0.350	65500	0.303	0.350	2026-03-09 03:46:10.423	2026-03-09 03:46:14.751	0.00	65500	Forever ARGI+ Sticks pack	504
cmmj0i1in001q147an27a1xjl	cmmj0cmng0003147a0uuk27cz	cmls3x9x5000m6gu5k6l06mvb	2	26000	0.120	0.100	52000	0.240	0.200	2026-03-09 10:02:00.624	2026-03-09 10:02:14.552	0.00	26000	Vitolize Men	374
cmmj0i1in001r147aop5xhf8v	cmmj0cmng0003147a0uuk27cz	cmm2aajt70000ie0ay4rcf48m	2	23500	0.107	0.100	47000	0.214	0.200	2026-03-09 10:02:00.624	2026-03-09 10:02:14.556	0.00	23500	Forever Multi-Maca	215
cmmj0i1in001s147a7pk1etol	cmmj0cmng0003147a0uuk27cz	cmls4fhxp00176gu5u13bgf1m	1	15000	0.069	0.100	15000	0.069	0.100	2026-03-09 10:02:00.624	2026-03-09 10:02:14.557	0.00	15000	Absorbent-C	48
cmmj0i1in001t147aj15v0l4q	cmmj0cmng0003147a0uuk27cz	cmls41vj0000o6gu5hlxu9pyq	1	6500	0.027	0.100	6500	0.027	0.100	2026-03-09 10:02:00.624	2026-03-09 10:02:14.559	0.00	6500	Aloe Avocado Face & Body Soap	284
cmmkrgi5x00255ihu3c913dyf	cmmkrfi2w000y5ihut1oggkt9	cmls4mrox00186gu5y2qefgjv	1	3150	0.014	0.010	3150	0.014	0.010	2026-03-10 15:24:24.693	2026-03-10 15:24:33.117	10.00	3500	Forever Aloe Lips	22
cmml6z3j7000iypqmtynfmtdy	cmml67lwu0003nfmehe75h6mp	cmls38zg300046gu59fpffhug	1	28800	0.146	1.000	28800	0.146	1.000	2026-03-10 22:38:46.436	2026-03-10 22:38:50.884	10.00	32000	Forever Freedom	196
cmml6z3j7000jypqmqfv4yjxj	cmml67lwu0003nfmehe75h6mp	cmls3gfzc000b6gu5o4loeinr	1	19800	0.100	1.000	19800	0.100	1.000	2026-03-10 22:38:46.436	2026-03-10 22:38:50.887	10.00	22000	Pulpe - Aloe Vera Gel - 1L	15
cmml8nvp50026a91568w0z1bi	cmml8ngz8001xa915uw1nlain	cmm7l59n80000ms2kgsiklkiz	1	60060	0.533	2.000	60060	0.533	2.000	2026-03-10 23:26:02.297	2026-03-10 23:26:16.043	48.00	115500	DX4	659
cmmlsbi8j001g12xy6sq70iin	cmmlsagxy000312xyntjpzq91	cmls3i2ka000c6gu5r0tuvg0x	1	11440	0.100	1.000	11440	0.100	1.000	2026-03-11 08:36:17.299	2026-03-11 08:36:29.026	48.00	22000	Aloe Berry Nectar	34
cmmlsbi8j001h12xyx9xdswj5	cmmlsagxy000312xyntjpzq91	cmls3r44r000d6gu58mrzo3rg	1	2600	0.019	0.282	2600	0.019	0.282	2026-03-11 08:36:17.299	2026-03-11 08:36:29.031	48.00	5000	FAB - Forever Active Boost	721
cmmlsbi8j001i12xyl4l8h5k1	cmmlsagxy000312xyntjpzq91	cmls4ot9e00196gu5susrhq13	1	6760	0.060	0.030	6760	0.060	0.030	2026-03-11 08:36:17.299	2026-03-11 08:36:29.033	48.00	13000	Aloe Heat Lotion	564
cmmlsbi8j001j12xyxyc9rn3b	cmmlsagxy000312xyntjpzq91	cmm3s6a9300002efo256oiqls	1	11440	0.100	1.000	11440	0.100	1.000	2026-03-11 08:36:17.299	2026-03-11 08:36:29.035	48.00	22000	Coeur d'Aloes	77
cmmlsbi8j001k12xycmobceeb	cmmlsagxy000312xyntjpzq91	cmm72tmhn0005zax6saur1hb3	1	22100	0.200	0.032	22100	0.200	0.032	2026-03-11 08:36:17.299	2026-03-11 08:36:29.039	48.00	42500	Forerver Vitamine C	686
cmmlsbi8j001l12xyrsmydf27	cmmlsagxy000312xyntjpzq91	cmm7l59n80000ms2kgsiklkiz	1	60060	0.533	2.000	60060	0.533	2.000	2026-03-11 08:36:17.299	2026-03-11 08:36:29.044	48.00	115500	DX4	659
cmmkrj0o4004v5ihuub497fs2	cmmkrhq11002f5ihuu24uq0c1	cmlskeut70000xe14vqohvp3b	1	26000	0.120	0.051	26000	0.120	0.051	2026-03-10 15:26:21.988	2026-03-10 15:26:33.772	0.00	26000	Garcinia Plus	71
cmmkrj0o4004w5ihuea63gq1m	cmmkrhq11002f5ihuu24uq0c1	cmlskghjo0001xe143p8q80fd	1	36500	0.167	0.050	36500	0.167	0.050	2026-03-10 15:26:21.988	2026-03-10 15:26:33.777	0.00	36500	Forever Lean	289
cmmkrj0o4004x5ihuuuc2owbo	cmmkrhq11002f5ihuu24uq0c1	cmm2ahxf10002ie0afqpgkxtv	1	25000	0.114	0.100	25000	0.114	0.100	2026-03-10 15:26:21.988	2026-03-10 15:26:33.779	0.00	25000	Forever Therm	463
cmmkrj0o4004y5ihuogqb893x	cmmkrhq11002f5ihuu24uq0c1	cmm4fjl05000013nmu3z26lrm	1	26500	0.123	0.375	26500	0.123	0.375	2026-03-10 15:26:21.988	2026-03-10 15:26:33.781	0.00	26500	Forever Lite Ultra Vanille	470
cmmkrj0o4004z5ihu58renl54	cmmkrhq11002f5ihuu24uq0c1	cmm4fmlxz000113nm2tqerc8d	1	26500	0.122	0.375	26500	0.122	0.375	2026-03-10 15:26:21.988	2026-03-10 15:26:33.782	0.00	26500	Forever Lite Ultra Chocolat	471
cmmkrj0o400505ihucw53wivx	cmmkrhq11002f5ihuu24uq0c1	cmm4gkrkv000213nmqlseecgo	1	5000	0.021	0.056	5000	0.021	0.056	2026-03-10 15:26:21.988	2026-03-10 15:26:33.784	0.00	5000	Forever Fast Break Bar	520
cmmm1i8ie000vhxjgb67djcex	cmmm1hgdf0009hxjg57wtgvk1	cmls3i2ka000c6gu5r0tuvg0x	1	0	0.000	0.000	0	0.000	0.000	2026-03-11 12:53:27.831	2026-03-11 12:53:27.831	0.00	0	\N	\N
cmmm1i8if000whxjgeu53f6r2	cmmm1hgdf0009hxjg57wtgvk1	cmls4fhxp00176gu5u13bgf1m	1	0	0.000	0.000	0	0.000	0.000	2026-03-11 12:53:27.831	2026-03-11 12:53:27.831	0.00	0	\N	\N
cmmm1i8if000xhxjg29263b8y	cmmm1hgdf0009hxjg57wtgvk1	cmm3s6a9300002efo256oiqls	1	0	0.000	0.000	0	0.000	0.000	2026-03-11 12:53:27.831	2026-03-11 12:53:27.831	0.00	0	\N	\N
cmmm1kinn001yhxjgd8evcitf	cmmm1k0830014hxjg53foxruc	cmls3i2ka000c6gu5r0tuvg0x	1	19800	0.100	1.000	19800	0.100	1.000	2026-03-11 12:55:14.291	2026-03-11 12:55:35.447	10.00	22000	Aloe Berry Nectar	34
cmmm1kinn001zhxjg25wnqma9	cmmm1k0830014hxjg53foxruc	cmls41vj0000o6gu5hlxu9pyq	1	5850	0.027	0.100	5850	0.027	0.100	2026-03-11 12:55:14.291	2026-03-11 12:55:35.453	10.00	6500	Aloe Avocado Face & Body Soap	284
cmmm1kinn0020hxjg1ddzeqi1	cmmm1k0830014hxjg53foxruc	cmls4fhxp00176gu5u13bgf1m	1	13500	0.069	0.100	13500	0.069	0.100	2026-03-11 12:55:14.291	2026-03-11 12:55:35.455	10.00	15000	Absorbent-C	48
cmmm1kinn0021hxjgram9ebs6	cmmm1k0830014hxjg53foxruc	cmls4ot9e00196gu5susrhq13	1	11700	0.060	0.030	11700	0.060	0.030	2026-03-11 12:55:14.291	2026-03-11 12:55:35.457	10.00	13000	Aloe Heat Lotion	564
cmmnbtwv2000ta885b0l2ogd4	cmml7uy0e0003a9157u2zj2u0	cmls3r44r000d6gu58mrzo3rg	1	0	0.000	0.000	0	0.000	0.000	2026-03-12 10:30:14.942	2026-03-12 10:30:14.942	0.00	0	\N	\N
cmmnbtwv2000ua88543fj2one	cmml7uy0e0003a9157u2zj2u0	cmm7l59n80000ms2kgsiklkiz	1	0	0.000	0.000	0	0.000	0.000	2026-03-12 10:30:14.942	2026-03-12 10:30:14.942	0.00	0	\N	\N
cmmncnsel001za885oxy13n2l	cmmnc6nq40017a885lodpzsoz	cmm7l59n80000ms2kgsiklkiz	2	80850	0.533	2.000	161700	1.066	4.000	2026-03-12 10:53:28.845	2026-03-12 10:54:34.249	30.00	115500	DX4	659
cmmndcruj000id4k84888su8w	cmmndbomy0003d4k8v76jcn1w	cmls4fhxp00176gu5u13bgf1m	1	0	0.000	0.000	0	0.000	0.000	2026-03-12 11:12:54.523	2026-03-12 11:12:54.523	0.00	0	\N	\N
cmmndcruj000jd4k8i4an6ems	cmmndbomy0003d4k8v76jcn1w	cmm72tmhn0005zax6saur1hb3	1	0	0.000	0.000	0	0.000	0.000	2026-03-12 11:12:54.523	2026-03-12 11:12:54.523	0.00	0	\N	\N
cmmnde4hm001cd4k8oyzdi41s	cmmnddm1p000qd4k804yjl4lt	cmlskeut70000xe14vqohvp3b	1	14820	0.120	0.051	14820	0.120	0.051	2026-03-12 11:13:57.562	2026-03-12 11:14:09.088	43.00	26000	Garcinia Plus	71
cmmnde4hm001dd4k84c7tvkam	cmmnddm1p000qd4k804yjl4lt	cmlskghjo0001xe143p8q80fd	1	20805	0.167	0.050	20805	0.167	0.050	2026-03-12 11:13:57.562	2026-03-12 11:14:09.091	43.00	36500	Forever Lean	289
cmmnde4hm001ed4k8l1b36a29	cmmnddm1p000qd4k804yjl4lt	cmm4fmlxz000113nm2tqerc8d	1	15105	0.122	0.375	15105	0.122	0.375	2026-03-12 11:13:57.562	2026-03-12 11:14:09.094	43.00	26500	Forever Lite Ultra Chocolat	471
\.


--
-- Data for Name: PreorderLog; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."PreorderLog" (id, "preorderId", note, meta, "createdAt", action) FROM stdin;
cmmewbw5l000510p8a28c0a1e	cmmewbw5e000310p8xl7c5h0j	Brouillon créé	{"fboId": "cmmewbw4z000010p8e0wudsfg", "numeroFbo": "225-000-145-746", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 12:54:10.57	CREATE_DRAFT
cmmewc18o000a10p8zvboe7b9	cmmewbw5e000310p8xl7c5h0j	Panier mis à jour	{"totalFcfa": 5850, "itemsCount": 1}	2026-03-06 12:54:17.161	SET_ITEMS
cmmewc3d4000g10p8qwekxety	cmmewbw5e000310p8xl7c5h0j	Panier mis à jour	{"totalFcfa": 19350, "itemsCount": 2}	2026-03-06 12:54:19.913	SET_ITEMS
cmmewc3xr000m10p87oka64q8	cmmewbw5e000310p8xl7c5h0j	Panier mis à jour	{"totalFcfa": 19350, "itemsCount": 2}	2026-03-06 12:54:20.655	SET_ITEMS
cmmewc79f000t10p8hdr3bcyp	cmmewbw5e000310p8xl7c5h0j	Panier mis à jour	{"totalFcfa": 39150, "itemsCount": 3}	2026-03-06 12:54:24.963	SET_ITEMS
cmmewc9fb001010p8ddoo93uj	cmmewbw5e000310p8xl7c5h0j	Panier mis à jour	{"totalFcfa": 39150, "itemsCount": 3}	2026-03-06 12:54:27.767	SET_ITEMS
cmmewccm5001310p8ibt4p9wn	cmmewbw5e000310p8xl7c5h0j	Précommande soumise	{"totalFcfa": 39150, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-06 12:54:31.901	SUBMIT
cmmeweayl001610p81yg1ilx1	cmmewbw5e000310p8xl7c5h0j	Préfacture créée	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentLink": null, "factureReference": "745862"}	2026-03-06 12:56:03.07	INVOICE
cmmeweva2001910p8mzoyqcb2	cmmewbw5e000310p8xl7c5h0j	39150	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentMode": "ESPECES"}	2026-03-06 12:56:29.403	MARK_PAID
cmmewj6gf001i10p8cw80vrkz	cmmewbw5e000310p8xl7c5h0j	- x1 34 Aloe Berry Nectar\n- x1 284 Aloe Avocado Face & Body Soap\n- x1 48 Absorbent-C	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-06 12:59:50.512	PREPARE
cmmewlg4g001l10p8f8zae40c	cmmewbw5e000310p8xl7c5h0j	Commande clôturée	{"toStatus": "FULFILLED", "fromStatus": "READY", "deliveryTracking": null}	2026-03-06 13:01:36.353	FULFILL
cmmeybkai0005co9dfm63cukl	cmmeybkad0003co9dkeura5q4	Brouillon créé	{"fboId": "cmmeybka50000co9dggwuf0lz", "numeroFbo": "225-114-588-445", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 13:49:54.426	CREATE_DRAFT
cmmeybpdu000aco9d0ug2p6x5	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 13950, "itemsCount": 1}	2026-03-06 13:50:01.026	SET_ITEMS
cmmeybr1w000fco9d5k9q9qgc	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 27900, "itemsCount": 1}	2026-03-06 13:50:03.189	SET_ITEMS
cmmeybtkb000kco9dnvib9103	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 41850, "itemsCount": 1}	2026-03-06 13:50:06.443	SET_ITEMS
cmmeybyzp000pco9dgkbmfenm	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 55800, "itemsCount": 1}	2026-03-06 13:50:13.478	SET_ITEMS
cmmeyc2eb000uco9dur3h1jcu	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 69750, "itemsCount": 1}	2026-03-06 13:50:17.892	SET_ITEMS
cmmeyc47v000zco9dgeymvauf	cmmeybkad0003co9dkeura5q4	Panier mis à jour	{"totalFcfa": 69750, "itemsCount": 1}	2026-03-06 13:50:20.251	SET_ITEMS
cmmeycnbu0015co9d1opdurwg	cmmeycnbp0013co9dtixvuaxo	Brouillon créé	{"fboId": "cmmeycnbe0010co9d2k9gphn9", "numeroFbo": "222-525-457-547", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 13:50:45.019	CREATE_DRAFT
cmmeycs5t001aco9dlqxww2wl	cmmeycnbp0013co9dtixvuaxo	Panier mis à jour	{"totalFcfa": 38250, "itemsCount": 1}	2026-03-06 13:50:51.282	SET_ITEMS
cmmeycufb001gco9d8bai2e22	cmmeycnbp0013co9dtixvuaxo	Panier mis à jour	{"totalFcfa": 142200, "itemsCount": 2}	2026-03-06 13:50:54.215	SET_ITEMS
cmmeycxh1001nco9d60sizgqi	cmmeycnbp0013co9dtixvuaxo	Panier mis à jour	{"totalFcfa": 201150, "itemsCount": 3}	2026-03-06 13:50:58.166	SET_ITEMS
cmmeyd06m001uco9dxj0jbix9	cmmeycnbp0013co9dtixvuaxo	Panier mis à jour	{"totalFcfa": 201150, "itemsCount": 3}	2026-03-06 13:51:01.679	SET_ITEMS
cmmeyd4qm001xco9dz8mylfej	cmmeycnbp0013co9dtixvuaxo	Précommande soumise	{"totalFcfa": 201150, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-06 13:51:07.583	SUBMIT
cmmeysa1g0023co9dl8fmjecl	cmmeysa160021co9docxg9cg7	Brouillon créé	{"fboId": "cmmeysa0u001yco9d81cc0bfi", "numeroFbo": "225-541-257-422", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 14:02:54.292	CREATE_DRAFT
cmmeyse450028co9dq5e8r115	cmmeysa160021co9docxg9cg7	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-06 14:02:59.573	SET_ITEMS
cmmeysfu7002dco9dw3f5b6j7	cmmeysa160021co9docxg9cg7	Panier mis à jour	{"totalFcfa": 30000, "itemsCount": 1}	2026-03-06 14:03:01.807	SET_ITEMS
cmmeysgug002ico9dfeh7is06	cmmeysa160021co9docxg9cg7	Panier mis à jour	{"totalFcfa": 30000, "itemsCount": 1}	2026-03-06 14:03:03.112	SET_ITEMS
cmmeysnzu002nco9d9s4qt6xn	cmmeysa160021co9docxg9cg7	Panier mis à jour	{"totalFcfa": 135000, "itemsCount": 1}	2026-03-06 14:03:12.378	SET_ITEMS
cmmeysqyf002sco9du8x1utdc	cmmeysa160021co9docxg9cg7	Panier mis à jour	{"totalFcfa": 135000, "itemsCount": 1}	2026-03-06 14:03:16.216	SET_ITEMS
cmmeytpkn002yco9deecgyyy5	cmmeytpkk002wco9dongbaxj8	Brouillon créé	{"fboId": "cmmeytpkf002tco9d5q9sqzpz", "numeroFbo": "225-000-000-872", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 14:04:01.08	CREATE_DRAFT
cmmeytsyd0033co9djm6wumig	cmmeytpkk002wco9dongbaxj8	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-06 14:04:05.461	SET_ITEMS
cmmeytv910038co9dvvmp5rgi	cmmeytpkk002wco9dongbaxj8	Panier mis à jour	{"totalFcfa": 165000, "itemsCount": 1}	2026-03-06 14:04:08.437	SET_ITEMS
cmmeytze9003dco9dspx8r7sm	cmmeytpkk002wco9dongbaxj8	Panier mis à jour	{"totalFcfa": 150000, "itemsCount": 1}	2026-03-06 14:04:13.809	SET_ITEMS
cmmeyu20y003ico9dy6nszciy	cmmeytpkk002wco9dongbaxj8	Panier mis à jour	{"totalFcfa": 150000, "itemsCount": 1}	2026-03-06 14:04:17.218	SET_ITEMS
cmmeyu6jh003lco9d053ljaq7	cmmeytpkk002wco9dongbaxj8	Précommande soumise	{"totalFcfa": 150000, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-06 14:04:23.07	SUBMIT
cmmeyvfae003oco9du7w94086	cmmeytpkk002wco9dongbaxj8	Préfacture créée	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentLink": null, "factureReference": "PF -2501452"}	2026-03-06 14:05:21.062	INVOICE
cmmeyw0gg003rco9dw4xv0csq	cmmeytpkk002wco9dongbaxj8	Preuve reçue	{"toStatus": "PAYMENT_PROOF_RECEIVED", "fromStatus": "INVOICED", "paymentRef": null}	2026-03-06 14:05:48.497	RECEIVE_PAYMENT_PROOF
cmmeywcc2003uco9dq5f9jrsx	cmmeytpkk002wco9dongbaxj8	Paiement vérifié	{"toStatus": "PAID", "fromStatus": "PAYMENT_PROOF_RECEIVED"}	2026-03-06 14:06:03.89	VERIFY_PAYMENT
cmmeywiw2003zco9d0ro7ypgu	cmmeytpkk002wco9dongbaxj8	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-06 14:06:12.386	PREPARE
cmmeywp9f0042co9d6cdcjwy8	cmmeytpkk002wco9dongbaxj8	Commande clôturée	{"toStatus": "FULFILLED", "fromStatus": "READY", "deliveryTracking": null}	2026-03-06 14:06:20.644	FULFILL
cmmez9grn0048co9dayhd14i2	cmmez9gq90046co9dwndbxn2d	Brouillon créé	{"fboId": "cmmez9goq0043co9db11igqqc", "numeroFbo": "226-000-147-852", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 14:16:16.164	CREATE_DRAFT
cmmez9ms2004dco9dvjxd5w82	cmmez9gq90046co9dwndbxn2d	Panier mis à jour	{"totalFcfa": 22000, "itemsCount": 1}	2026-03-06 14:16:23.954	SET_ITEMS
cmmez9q1j004ico9dnb35752h	cmmez9gq90046co9dwndbxn2d	Panier mis à jour	{"totalFcfa": 44000, "itemsCount": 1}	2026-03-06 14:16:28.184	SET_ITEMS
cmmez9s84004nco9d05zu5pba	cmmez9gq90046co9dwndbxn2d	Panier mis à jour	{"totalFcfa": 66000, "itemsCount": 1}	2026-03-06 14:16:31.012	SET_ITEMS
cmmez9umv004sco9de8v9cov3	cmmez9gq90046co9dwndbxn2d	Panier mis à jour	{"totalFcfa": 88000, "itemsCount": 1}	2026-03-06 14:16:34.136	SET_ITEMS
cmmez9z7f004xco9dje99snaa	cmmez9gq90046co9dwndbxn2d	Panier mis à jour	{"totalFcfa": 88000, "itemsCount": 1}	2026-03-06 14:16:40.059	SET_ITEMS
cmmeza3pw0050co9d0y5k3h43	cmmez9gq90046co9dwndbxn2d	Précommande soumise	{"totalFcfa": 88000, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-06 14:16:45.909	SUBMIT
cmmfgp41j0002xs5uy94nqmjx	cmmez9gq90046co9dwndbxn2d	Préfacture créée	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentLink": null, "factureReference": "PF-20260306-226000147852"}	2026-03-06 22:24:19.64	INVOICE
cmmfgpd300005xs5uby0kfnu2	cmmez9gq90046co9dwndbxn2d	Preuve reçue	{"toStatus": "PAYMENT_PROOF_RECEIVED", "fromStatus": "INVOICED", "paymentRef": null}	2026-03-06 22:24:31.356	RECEIVE_PAYMENT_PROOF
cmmfhzsb80005ph8fo344737a	cmmfhzsb40003ph8fdm5yzh9u	Brouillon créé	{"fboId": "cmmfhzsay0000ph8f0s22ww5j", "numeroFbo": "225-000-222-887", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 23:00:37.269	CREATE_DRAFT
cmmfi0373000aph8f7gipubwd	cmmfhzsb40003ph8fdm5yzh9u	Panier mis à jour	{"totalFcfa": 14400, "itemsCount": 1}	2026-03-06 23:00:51.375	SET_ITEMS
cmmfi09bf000gph8f09srnq6u	cmmfhzsb40003ph8fdm5yzh9u	Panier mis à jour	{"totalFcfa": 37800, "itemsCount": 2}	2026-03-06 23:00:59.308	SET_ITEMS
cmmfi0iu9000mph8fz6nxifg1	cmmfhzsb40003ph8fdm5yzh9u	Panier mis à jour	{"totalFcfa": 37800, "itemsCount": 2}	2026-03-06 23:01:11.65	SET_ITEMS
cmmfi0npt000pph8fzib7e3qw	cmmfhzsb40003ph8fdm5yzh9u	Précommande soumise	{"totalFcfa": 37800, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-06 23:01:17.97	SUBMIT
cmmfixcro0002vt66mo03elii	cmmfhzsb40003ph8fdm5yzh9u	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_eaw1tB7lJ3", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_eaw1tB7lJ3", "factureReference": "PF-20260306-225000222887"}	2026-03-06 23:26:43.429	INVOICE
cmmfj3zg70005vt66xid092b7	cmmfhzsb40003ph8fdm5yzh9u	Preuve reçue	{"toStatus": "PAYMENT_PROOF_RECEIVED", "fromStatus": "INVOICED", "paymentRef": "test_eaw1tB7lJ3"}	2026-03-06 23:31:52.759	RECEIVE_PAYMENT_PROOF
cmmfjieid0008vt66xzrem4u7	cmmfhzsb40003ph8fdm5yzh9u	Paiement vérifié	{"toStatus": "PAID", "fromStatus": "PAYMENT_PROOF_RECEIVED"}	2026-03-06 23:43:05.462	VERIFY_PAYMENT
cmmfjzbbz0005qpo5me7b7d5t	cmmfjzbbm0003qpo561nxmp9r	Brouillon créé	{"fboId": "cmmfjzb9p0000qpo58d87dj8s", "numeroFbo": "226-457-145-789", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 23:56:14.496	CREATE_DRAFT
cmmfjzqnw000aqpo5sy72fqcd	cmmfjzbbm0003qpo561nxmp9r	Panier mis à jour	{"totalFcfa": 32850, "itemsCount": 1}	2026-03-06 23:56:34.365	SET_ITEMS
cmmfk03bl000gqpo5jtytakua	cmmfjzbbm0003qpo561nxmp9r	Panier mis à jour	{"totalFcfa": 54000, "itemsCount": 2}	2026-03-06 23:56:50.769	SET_ITEMS
cmmfk07k9000mqpo5r5fnwa6u	cmmfjzbbm0003qpo561nxmp9r	Panier mis à jour	{"totalFcfa": 54000, "itemsCount": 2}	2026-03-06 23:56:56.265	SET_ITEMS
cmmfk13uf000sqpo56avrlj0k	cmmfk13uc000qqpo5xz9ldsor	Brouillon créé	{"fboId": "cmmfk13u4000nqpo5rre2f569", "numeroFbo": "225-000-145-236", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-06 23:57:38.103	CREATE_DRAFT
cmmfk19zz000xqpo5omj2f412	cmmfk13uc000qqpo5xz9ldsor	Panier mis à jour	{"totalFcfa": 22000, "itemsCount": 1}	2026-03-06 23:57:46.079	SET_ITEMS
cmmfk1gdj0013qpo53vgyffie	cmmfk13uc000qqpo5xz9ldsor	Panier mis à jour	{"totalFcfa": 44000, "itemsCount": 2}	2026-03-06 23:57:54.343	SET_ITEMS
cmmfk1l6u0019qpo5dciehaux	cmmfk13uc000qqpo5xz9ldsor	Panier mis à jour	{"totalFcfa": 44000, "itemsCount": 2}	2026-03-06 23:58:00.582	SET_ITEMS
cmmfk1rjq001cqpo5pdeh4a8q	cmmfk13uc000qqpo5xz9ldsor	Précommande soumise	{"totalFcfa": 44000, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-06 23:58:08.822	SUBMIT
cmmfk3drf001fqpo5vdk8q020	cmmfk13uc000qqpo5xz9ldsor	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_IeKaxSfv9U", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_IeKaxSfv9U", "factureReference": "41256278"}	2026-03-06 23:59:24.267	INVOICE
cmmfk6ilo001iqpo5sfld7828	cmmfk13uc000qqpo5xz9ldsor	Preuve reçue	{"toStatus": "PAYMENT_PROOF_RECEIVED", "fromStatus": "INVOICED", "paymentRef": "test_IeKaxSfv9U"}	2026-03-07 00:01:50.508	RECEIVE_PAYMENT_PROOF
cmmfkkdnu001lqpo5bpcx69bp	cmmfk13uc000qqpo5xz9ldsor	Paiement vérifié	{"toStatus": "PAID", "fromStatus": "PAYMENT_PROOF_RECEIVED"}	2026-03-07 00:12:37.29	VERIFY_PAYMENT
cmmfkq2q50005obosp171ctt4	cmmfkq2pz0003obosmskoczag	Brouillon créé	{"fboId": "cmmfkq2pk0000oboswtct08nl", "numeroFbo": "225-000-412-589", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 00:17:03.054	CREATE_DRAFT
cmmfkq7rj000aoboshsjmasn0	cmmfkq2pz0003obosmskoczag	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 00:17:09.583	SET_ITEMS
cmmfkq96y000gobosgnfp76zd	cmmfkq2pz0003obosmskoczag	Panier mis à jour	{"totalFcfa": 37000, "itemsCount": 2}	2026-03-07 00:17:11.435	SET_ITEMS
cmmfkqad8000mobos3vuebi5h	cmmfkq2pz0003obosmskoczag	Panier mis à jour	{"totalFcfa": 37000, "itemsCount": 2}	2026-03-07 00:17:12.957	SET_ITEMS
cmmfkqgo4000sobosedfhuk7x	cmmfkq2pz0003obosmskoczag	Panier mis à jour	{"totalFcfa": 37000, "itemsCount": 2}	2026-03-07 00:17:21.125	SET_ITEMS
cmmfkr9c2000yobosjvkf8ggl	cmmfkr9bx000wobosmgo8zsa0	Brouillon créé	{"fboId": "cmmfkr9bs000tobosre3nmhwb", "numeroFbo": "225-336-225-145", "paymentMode": "ORANGE_MONEY", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 00:17:58.274	CREATE_DRAFT
cmmfkrdlw0013obosiy9ub2jq	cmmfkr9bx000wobosmgo8zsa0	Panier mis à jour	{"totalFcfa": 22000, "itemsCount": 1}	2026-03-07 00:18:03.813	SET_ITEMS
cmmfkrfdk0019obosx7pluyj5	cmmfkr9bx000wobosmgo8zsa0	Panier mis à jour	{"totalFcfa": 37000, "itemsCount": 2}	2026-03-07 00:18:06.104	SET_ITEMS
cmmfkrigy001fobos9epzzkcl	cmmfkr9bx000wobosmgo8zsa0	Panier mis à jour	{"totalFcfa": 37000, "itemsCount": 2}	2026-03-07 00:18:10.114	SET_ITEMS
cmmfkro02001ioboscibapam7	cmmfkr9bx000wobosmgo8zsa0	Précommande soumise	{"totalFcfa": 37000, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-07 00:18:17.282	SUBMIT
cmmfkt0di001lobos3wzn3c4s	cmmfkr9bx000wobosmgo8zsa0	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_KQfuti1Qv0", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_KQfuti1Qv0", "factureReference": "74589623"}	2026-03-07 00:19:19.974	INVOICE
cmmfktvnx001oobos1o7139u2	cmmfkr9bx000wobosmgo8zsa0	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_KQfuti1Qv0", "paydunyaStatus": "completed"}	2026-03-07 00:20:00.525	VERIFY_PAYMENT
cmmfm1ed70005hab83ipp7l1r	cmmfm1ecx0003hab80o5vuce4	Brouillon créé	{"fboId": "cmmfm1eco0000hab8gbq6m4bf", "numeroFbo": "225-000-111-444", "paymentMode": "ORANGE_MONEY", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 00:53:50.972	CREATE_DRAFT
cmmfm1n5w000ahab81sd9o30v	cmmfm1ecx0003hab80o5vuce4	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 1}	2026-03-07 00:54:02.373	SET_ITEMS
cmmfm1pwe000fhab8qli8vvae	cmmfm1ecx0003hab80o5vuce4	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 1}	2026-03-07 00:54:05.919	SET_ITEMS
cmmfm1zb6000ihab8j5ajmi8x	cmmfm1ecx0003hab80o5vuce4	Précommande soumise	{"totalFcfa": 65500, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-07 00:54:18.114	SUBMIT
cmmfm409f000lhab8oam9vn9x	cmmfm1ecx0003hab80o5vuce4	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_w24XRgIkWb", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_w24XRgIkWb", "factureReference": "225874895"}	2026-03-07 00:55:52.66	INVOICE
cmmfm4rw6000ohab8ez78bvme	cmmfm1ecx0003hab80o5vuce4	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_w24XRgIkWb", "paydunyaStatus": "completed"}	2026-03-07 00:56:28.47	VERIFY_PAYMENT
cmmfo45v500058184qrmzsarp	cmmfo45tf00038184xc8tfvxp	Brouillon créé	{"fboId": "cmmfo45t700008184kayjg7wi", "numeroFbo": "228-000-145-784", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 01:51:59.154	CREATE_DRAFT
cmmfo4ec1000a8184sg3lifce	cmmfo45tf00038184xc8tfvxp	Panier mis à jour	{"totalFcfa": 42500, "itemsCount": 1}	2026-03-07 01:52:10.13	SET_ITEMS
cmmfo4kk0000g8184pgxvmpj5	cmmfo45tf00038184xc8tfvxp	Panier mis à jour	{"totalFcfa": 58000, "itemsCount": 2}	2026-03-07 01:52:18.192	SET_ITEMS
cmmfo4mw0000n81847uesoued	cmmfo45tf00038184xc8tfvxp	Panier mis à jour	{"totalFcfa": 63000, "itemsCount": 3}	2026-03-07 01:52:21.217	SET_ITEMS
cmmfo4p2c000u8184s9qj2wpa	cmmfo45tf00038184xc8tfvxp	Panier mis à jour	{"totalFcfa": 68000, "itemsCount": 3}	2026-03-07 01:52:24.036	SET_ITEMS
cmmfo4vqu001181841agmalgt	cmmfo45tf00038184xc8tfvxp	Panier mis à jour	{"totalFcfa": 68000, "itemsCount": 3}	2026-03-07 01:52:32.694	SET_ITEMS
cmmfo53r800148184ikrspouv	cmmfo45tf00038184xc8tfvxp	Précommande soumise	{"totalFcfa": 68000, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-07 01:52:43.077	SUBMIT
cmmfo60vs00178184w0pdf8p5	cmmfo45tf00038184xc8tfvxp	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_YwF4Bm4b0i", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_YwF4Bm4b0i", "factureReference": "PF202623541"}	2026-03-07 01:53:26.007	INVOICE
cmmfo978u001a8184kem38oew	cmmfo45tf00038184xc8tfvxp	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_YwF4Bm4b0i", "paydunyaStatus": "completed"}	2026-03-07 01:55:54.222	VERIFY_PAYMENT
cmmg0hgmg0005x32g8hzndkur	cmmg0hgmb0003x32gpt92ynd1	Brouillon créé	{"fboId": "cmlz8di1y000iub6y1n9l6zy4", "numeroFbo": "225-000-123-456", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 07:38:15.017	CREATE_DRAFT
cmmg0hmta000ax32ghbykvlkk	cmmg0hgmb0003x32gpt92ynd1	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 07:38:23.038	SET_ITEMS
cmmg0hpin000gx32gsyjoeqk5	cmmg0hgmb0003x32gpt92ynd1	Panier mis à jour	{"totalFcfa": 21500, "itemsCount": 2}	2026-03-07 07:38:26.543	SET_ITEMS
cmmg0hx2n000nx32gst5vif2l	cmmg0hgmb0003x32gpt92ynd1	Panier mis à jour	{"totalFcfa": 37500, "itemsCount": 3}	2026-03-07 07:38:36.336	SET_ITEMS
cmmg0i29f000vx32gdv42sycu	cmmg0hgmb0003x32gpt92ynd1	Panier mis à jour	{"totalFcfa": 50500, "itemsCount": 4}	2026-03-07 07:38:43.059	SET_ITEMS
cmmg0i4iq0013x32g5f8mhgxk	cmmg0hgmb0003x32gpt92ynd1	Panier mis à jour	{"totalFcfa": 50500, "itemsCount": 4}	2026-03-07 07:38:45.987	SET_ITEMS
cmmg0jmur0019x32ghghc1702	cmmg0jmum0017x32gyuzpcvrm	Brouillon créé	{"fboId": "cmmg0jmuf0014x32g79db3157", "numeroFbo": "225-000-145-521", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 07:39:56.403	CREATE_DRAFT
cmmg0jti3001ex32gmor9976q	cmmg0jmum0017x32gyuzpcvrm	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 07:40:05.02	SET_ITEMS
cmmg0jvic001kx32gz6dejj4c	cmmg0jmum0017x32gyuzpcvrm	Panier mis à jour	{"totalFcfa": 21500, "itemsCount": 2}	2026-03-07 07:40:07.621	SET_ITEMS
cmmg0jxc7001rx32gjp93ud37	cmmg0jmum0017x32gyuzpcvrm	Panier mis à jour	{"totalFcfa": 34500, "itemsCount": 3}	2026-03-07 07:40:09.991	SET_ITEMS
cmmg0k001001zx32g274tv1zi	cmmg0jmum0017x32gyuzpcvrm	Panier mis à jour	{"totalFcfa": 56500, "itemsCount": 4}	2026-03-07 07:40:13.441	SET_ITEMS
cmmg0k3m20027x32gulktoffp	cmmg0jmum0017x32gyuzpcvrm	Panier mis à jour	{"totalFcfa": 56500, "itemsCount": 4}	2026-03-07 07:40:18.122	SET_ITEMS
cmmg0l7vb002dx32gon6hmll4	cmmg0l7v8002bx32gq137c276	Brouillon créé	{"fboId": "cmmg0l7v30028x32gh4ypsxsg", "numeroFbo": "225-000-325-425", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 07:41:10.296	CREATE_DRAFT
cmmg0lb7m002ix32g1n5yng0v	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 22000, "itemsCount": 1}	2026-03-07 07:41:14.626	SET_ITEMS
cmmg0ldhp002ox32giynuveq0	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 35000, "itemsCount": 2}	2026-03-07 07:41:17.581	SET_ITEMS
cmmg0lgvx002vx32gw8vnbmka	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 57000, "itemsCount": 3}	2026-03-07 07:41:21.982	SET_ITEMS
cmmg0lk5s0033x32grs6lfq1q	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 63500, "itemsCount": 4}	2026-03-07 07:41:26.224	SET_ITEMS
cmmg0lmpv003cx32geoh657ke	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 78500, "itemsCount": 5}	2026-03-07 07:41:29.539	SET_ITEMS
cmmg0lpcs003lx32gu2mar4w8	cmmg0l7v8002bx32gq137c276	Panier mis à jour	{"totalFcfa": 78500, "itemsCount": 5}	2026-03-07 07:41:32.957	SET_ITEMS
cmmg0lv0p003ox32gphz53oit	cmmg0l7v8002bx32gq137c276	Précommande soumise	{"totalFcfa": 78500, "itemsCount": 5, "whatsappTo": "+2250506025071"}	2026-03-07 07:41:40.298	SUBMIT
cmmhf82pi0016m9889kw5ypsf	cmmhf7dv4000cm988xspalpqy	Précommande soumise	{"totalFcfa": 109480, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-08 07:18:37.494	SUBMIT
cmmg0qm8q003rx32gno1o9av5	cmmg0l7v8002bx32gq137c276	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_prN559aJFY", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_prN559aJFY", "factureReference": "PF250254"}	2026-03-07 07:45:22.202	INVOICE
cmmg0swh3003ux32gh00kq2x1	cmmg0l7v8002bx32gq137c276	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_prN559aJFY", "paydunyaStatus": "completed"}	2026-03-07 07:47:08.775	VERIFY_PAYMENT
cmmg7wr030005lmbso1ia407c	cmmg7wqzu0003lmbsvydsd79u	Brouillon créé	{"fboId": "cmmg7wqzd0000lmbsjw7l6uz7", "numeroFbo": "085-421-369-852", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 11:06:05.62	CREATE_DRAFT
cmmg7xdg9000almbsoljttz9b	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 11:06:34.713	SET_ITEMS
cmmg7xmu4000glmbst3yhjowe	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 21500, "itemsCount": 2}	2026-03-07 11:06:46.877	SET_ITEMS
cmmg7xv0h000llmbslvqif4go	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 11:06:57.473	SET_ITEMS
cmmg7yoma000plmbsb3mkxtx6	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-07 11:07:35.843	SET_ITEMS
cmmg7yrzv000ulmbsr2ppzbyj	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 11:07:40.219	SET_ITEMS
cmmg7z4tk000ylmbs0pand324	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-07 11:07:56.84	SET_ITEMS
cmmg7z8kj0013lmbspivqvkst	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 15000, "itemsCount": 1}	2026-03-07 11:08:01.7	SET_ITEMS
cmmg7zd090019lmbs1buc98um	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 21500, "itemsCount": 2}	2026-03-07 11:08:07.45	SET_ITEMS
cmmg7zv8f001glmbsvs2yllsg	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 43500, "itemsCount": 3}	2026-03-07 11:08:31.071	SET_ITEMS
cmmg80b4e001nlmbsxsbyh5rz	cmmg7wqzu0003lmbsvydsd79u	Panier mis à jour	{"totalFcfa": 43500, "itemsCount": 3}	2026-03-07 11:08:51.662	SET_ITEMS
cmmg80rv9001qlmbsem4q3rkj	cmmg7wqzu0003lmbsvydsd79u	Précommande soumise	{"totalFcfa": 43500, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-07 11:09:13.366	SUBMIT
cmmgannwd00052izz8ouoi4gg	cmmgannw700032izzvgvklsa7	Brouillon créé	{"fboId": "cmmgannu800002izz4bpshbud", "numeroFbo": "225-000-112-335", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 12:23:00.541	CREATE_DRAFT
cmmgans6c000a2izzja3cdaaf	cmmgannw700032izzvgvklsa7	Panier mis à jour	{"totalFcfa": 19800, "itemsCount": 1}	2026-03-07 12:23:06.084	SET_ITEMS
cmmganz93000g2izznypmy37b	cmmgannw700032izzvgvklsa7	Panier mis à jour	{"totalFcfa": 39600, "itemsCount": 2}	2026-03-07 12:23:15.256	SET_ITEMS
cmmgao4fe000m2izz8c170nob	cmmgannw700032izzvgvklsa7	Panier mis à jour	{"totalFcfa": 39600, "itemsCount": 2}	2026-03-07 12:23:21.963	SET_ITEMS
cmmgaop3i000p2izzyrxwy4z2	cmmgannw700032izzvgvklsa7	Précommande soumise	{"totalFcfa": 39600, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-07 12:23:48.751	SUBMIT
cmmgavqan000v2izztnwdydzq	cmmgavqa7000t2izzjm1r0bam	Brouillon créé	{"fboId": "cmmgavqa0000q2izzbu3zwlrv", "numeroFbo": "225-008-745-236", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 12:29:16.895	CREATE_DRAFT
cmmgavv2t00102izzx9uom5gh	cmmgavqa7000t2izzjm1r0bam	Panier mis à jour	{"totalFcfa": 115500, "itemsCount": 1}	2026-03-07 12:29:23.094	SET_ITEMS
cmmgavxcj00152izzfsuuzsrr	cmmgavqa7000t2izzjm1r0bam	Panier mis à jour	{"totalFcfa": 115500, "itemsCount": 1}	2026-03-07 12:29:26.036	SET_ITEMS
cmmgaxl3t00182izzqnbdke24	cmmgavqa7000t2izzjm1r0bam	Précommande soumise	{"totalFcfa": 115500, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-07 12:30:43.481	SUBMIT
cmmgr128m0005ng16vt3p6o5u	cmmgr128g0003ng164v3p631u	Brouillon créé	{"fboId": "cmmgr126p0000ng16s62wwcub", "numeroFbo": "222-555-666-333", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-07 20:01:19.51	CREATE_DRAFT
cmmgr1c5q000ang161r76eu50	cmmgr128g0003ng164v3p631u	Panier mis à jour	{"totalFcfa": 38250, "itemsCount": 1}	2026-03-07 20:01:32.367	SET_ITEMS
cmmgr1ebs000gng162th5j01l	cmmgr128g0003ng164v3p631u	Panier mis à jour	{"totalFcfa": 52650, "itemsCount": 2}	2026-03-07 20:01:35.176	SET_ITEMS
cmmgr1gp9000mng16jpbidr5l	cmmgr128g0003ng164v3p631u	Panier mis à jour	{"totalFcfa": 52650, "itemsCount": 2}	2026-03-07 20:01:38.254	SET_ITEMS
cmmgr1n33000png165fhp6h1o	cmmgr128g0003ng164v3p631u	Précommande soumise	{"totalFcfa": 52650, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-07 20:01:46.527	SUBMIT
cmmgr2zdj000sng163gfxow8t	cmmgr128g0003ng164v3p631u	Préfacture créée - paiement en espèces	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": null, "paymentFlow": "MANUAL", "paymentLink": null, "paymentMode": "ESPECES", "paymentProvider": "CASH", "factureReference": "451254"}	2026-03-07 20:02:49.112	INVOICE
cmmgr3hmh000vng163fu0zdqo	cmmgr128g0003ng164v3p631u	52650	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentMode": "ESPECES"}	2026-03-07 20:03:12.762	MARK_PAID
cmmheqg9m0002m988m9uup2sl	cmmgavqa7000t2izzjm1r0bam	Préfacture créée - paiement en espèces	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": null, "paymentFlow": "MANUAL", "paymentLink": null, "paymentMode": "ESPECES", "paymentProvider": "CASH", "factureReference": "254153"}	2026-03-08 07:04:55.259	INVOICE
cmmhes4rp0005m988uzur56i4	cmmgavqa7000t2izzjm1r0bam	115500	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentMode": "ESPECES"}	2026-03-08 07:06:13.669	MARK_PAID
cmmhf25en0008m988y0rvl986	cmmg7wqzu0003lmbsvydsd79u	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_I9M21ponM4", "paymentFlow": "AUTO", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_I9M21ponM4", "paymentMode": "WAVE", "paymentProvider": "PAYDUNYA", "factureReference": "254125"}	2026-03-08 07:14:01.056	INVOICE
cmmhf7dva000em988ze8hm2u3	cmmhf7dv4000cm988xspalpqy	Brouillon créé	{"fboId": "cmmhf7duu0009m988n0zdix93", "numeroFbo": "225-000-856-087", "paymentMode": "ORANGE_MONEY", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-08 07:18:05.303	CREATE_DRAFT
cmmhf7ldb000jm988upmvam2u	cmmhf7dv4000cm988xspalpqy	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 1}	2026-03-08 07:18:15.024	SET_ITEMS
cmmhf7otg000pm9886ym9jzeq	cmmhf7dv4000cm988xspalpqy	Panier mis à jour	{"totalFcfa": 81000, "itemsCount": 2}	2026-03-08 07:18:19.493	SET_ITEMS
cmmhf7rxw000wm9882vox5ud8	cmmhf7dv4000cm988xspalpqy	Panier mis à jour	{"totalFcfa": 109480, "itemsCount": 3}	2026-03-08 07:18:23.541	SET_ITEMS
cmmhf7tzi0013m988ue6zme7k	cmmhf7dv4000cm988xspalpqy	Panier mis à jour	{"totalFcfa": 109480, "itemsCount": 3}	2026-03-08 07:18:26.19	SET_ITEMS
cmmhfwugg00024wls86te2fo3	cmmhf7dv4000cm988xspalpqy	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_LK3W9y6fJo", "paymentFlow": "AUTO", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_LK3W9y6fJo", "paymentMode": "ORANGE_MONEY", "paymentProvider": "PAYDUNYA", "factureReference": "457125"}	2026-03-08 07:37:53.201	INVOICE
cmmhfytcy00054wlsrrs0ih6f	cmmhf7dv4000cm988xspalpqy	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_LK3W9y6fJo", "paydunyaStatus": "completed"}	2026-03-08 07:39:25.09	VERIFY_PAYMENT
cmmi18mh600023na6ndiibzah	cmmez9gq90046co9dwndbxn2d	Paiement vérifié	{"toStatus": "PAID", "fromStatus": "PAYMENT_PROOF_RECEIVED"}	2026-03-08 17:34:54.666	VERIFY_PAYMENT
cmmi1dg3200083na6a6982tmz	cmmi1dg2x00063na6mjc3tcju	Brouillon créé	{"fboId": "cmmi1dg2n00033na6kdr3ywre", "numeroFbo": "225-000-852-665", "paymentMode": "ORANGE_MONEY", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-08 17:38:39.662	CREATE_DRAFT
cmmi1drp1000d3na6f4pcpynd	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 32000, "itemsCount": 1}	2026-03-08 17:38:54.71	SET_ITEMS
cmmi1dw2p000j3na6n4nb50zn	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 48000, "itemsCount": 2}	2026-03-08 17:39:00.385	SET_ITEMS
cmmi1dywp000q3na67yk1qk08	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 74500, "itemsCount": 3}	2026-03-08 17:39:04.057	SET_ITEMS
cmmi1e0u1000y3na620bz553f	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 111000, "itemsCount": 4}	2026-03-08 17:39:06.553	SET_ITEMS
cmmi1e4mw00153na682e1p85a	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 95000, "itemsCount": 3}	2026-03-08 17:39:11.48	SET_ITEMS
cmmi1e71c001c3na681bgf3jv	cmmi1dg2x00063na6mjc3tcju	Panier mis à jour	{"totalFcfa": 95000, "itemsCount": 3}	2026-03-08 17:39:14.592	SET_ITEMS
cmmi1edtu001f3na6lmibqhom	cmmi1dg2x00063na6mjc3tcju	Précommande soumise	{"totalFcfa": 95000, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-08 17:39:23.394	SUBMIT
cmmi1g6ns001i3na6mitw6f3e	cmmi1dg2x00063na6mjc3tcju	Préfacture créée via PayDunya	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": "test_94NEdllZPw", "paymentFlow": "AUTO", "paymentLink": "https://paydunya.com/sandbox-checkout/invoice/test_94NEdllZPw", "paymentMode": "ORANGE_MONEY", "paymentProvider": "PAYDUNYA", "factureReference": "254145"}	2026-03-08 17:40:47.416	INVOICE
cmmi1iowd001l3na6lzqywbz1	cmmi1dg2x00063na6mjc3tcju	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_94NEdllZPw", "paydunyaStatus": "completed"}	2026-03-08 17:42:44.366	VERIFY_PAYMENT
cmmi1l5iq001u3na6fn290xfi	cmmi1dg2x00063na6mjc3tcju	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-08 17:44:39.219	PREPARE
cmmi23d8u001x3na6j2sg4hfd	cmmgannw700032izzvgvklsa7	Paiement à la caisse	{"toStatus": "INVOICED", "fromStatus": "SUBMITTED", "paymentRef": null, "paymentFlow": "MANUAL", "paymentLink": null, "paymentMode": "ESPECES", "paymentProvider": "CASH", "factureReference": "2545178"}	2026-03-08 17:58:49.038	INVOICE
cmmi242ks00203na6zqlqzte0	cmmgannw700032izzvgvklsa7	39600	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentMode": "ESPECES"}	2026-03-08 17:59:21.868	MARK_PAID
cmmii5rbe0005qjcwte35nvyr	cmmii5rad0003qjcwgitocdhs	Brouillon créé	{"fboId": "cmmii5ra50000qjcwhy1czhoz", "numeroFbo": "225-000-858-741", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 01:28:34.442	CREATE_DRAFT
cmmii5xys000aqjcwy3buift0	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 26000, "itemsCount": 1}	2026-03-09 01:28:43.06	SET_ITEMS
cmmii60en000gqjcwx7k9gf9a	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 52000, "itemsCount": 2}	2026-03-09 01:28:46.223	SET_ITEMS
cmmii641l000nqjcw8m62gl80	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 59000, "itemsCount": 3}	2026-03-09 01:28:50.938	SET_ITEMS
cmmii65fi000vqjcw45g7scj6	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 81000, "itemsCount": 4}	2026-03-09 01:28:52.734	SET_ITEMS
cmmii68hn0014qjcwfrzk4est	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 109500, "itemsCount": 5}	2026-03-09 01:28:56.7	SET_ITEMS
cmmii6b6r001dqjcwn1fo2j4u	cmmii5rad0003qjcwgitocdhs	Panier mis à jour	{"totalFcfa": 109500, "itemsCount": 5}	2026-03-09 01:29:00.195	SET_ITEMS
cmmiiauva001jqjcw6gfvej4m	cmmiiauuu001hqjcwxgyvmewh	Brouillon créé	{"fboId": "cmmiiauu4001eqjcwtjf7ccx7", "numeroFbo": "225-000-142-125", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 01:32:32.327	CREATE_DRAFT
cmmiib1vw001oqjcw1ur0hmfp	cmmiiauuu001hqjcwxgyvmewh	Panier mis à jour	{"totalFcfa": 23400, "itemsCount": 1}	2026-03-09 01:32:41.421	SET_ITEMS
cmmiib3yh001uqjcwbdbcu4z3	cmmiiauuu001hqjcwxgyvmewh	Panier mis à jour	{"totalFcfa": 35100, "itemsCount": 2}	2026-03-09 01:32:44.105	SET_ITEMS
cmmiib4v40020qjcwcgrxc765	cmmiiauuu001hqjcwxgyvmewh	Panier mis à jour	{"totalFcfa": 35100, "itemsCount": 2}	2026-03-09 01:32:45.281	SET_ITEMS
cmmiib68t0027qjcw9bmowog8	cmmiiauuu001hqjcwxgyvmewh	Panier mis à jour	{"totalFcfa": 49050, "itemsCount": 3}	2026-03-09 01:32:47.07	SET_ITEMS
cmmiib924002eqjcw3zgly8r1	cmmiiauuu001hqjcwxgyvmewh	Panier mis à jour	{"totalFcfa": 49050, "itemsCount": 3}	2026-03-09 01:32:50.716	SET_ITEMS
cmmiiyy2c00024o4a9i0d341d	cmmiiauuu001hqjcwxgyvmewh	Précommande soumise	{"totalFcfa": 49050, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-09 01:51:16.212	SUBMIT
cmmij0jwr00094o4aww4meida	cmmiiauuu001hqjcwxgyvmewh	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmij0jw300054o4ae0048xbw", "invoiceRef": "20251452", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://pay.example.com/preorders/cmmiiauuu001hqjcwxgyvmewh?invoice=20251452", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmiiauuu001hqjcwxgyvmewh/cmmij0jw300054o4ae0048xbw"}	2026-03-09 01:52:31.18	INVOICE
cmmikvfuo000f4o4a6tsbgtst	cmmikvfui000d4o4apwj0j5o4	Brouillon créé	{"fboId": "cmmikvfu8000a4o4a4uv4rfwm", "numeroFbo": "365-258-415-896", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 02:44:31.872	CREATE_DRAFT
cmmikvmj6000k4o4axqi6a02y	cmmikvfui000d4o4apwj0j5o4	Panier mis à jour	{"totalFcfa": 26000, "itemsCount": 1}	2026-03-09 02:44:40.53	SET_ITEMS
cmmikvnyk000q4o4au27n99cq	cmmikvfui000d4o4apwj0j5o4	Panier mis à jour	{"totalFcfa": 52000, "itemsCount": 2}	2026-03-09 02:44:42.38	SET_ITEMS
cmmikvq7d000w4o4ar6h2ioib	cmmikvfui000d4o4apwj0j5o4	Panier mis à jour	{"totalFcfa": 52000, "itemsCount": 2}	2026-03-09 02:44:45.289	SET_ITEMS
cmmikvv9x000z4o4aul76w353	cmmikvfui000d4o4apwj0j5o4	Précommande soumise	{"totalFcfa": 52000, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-09 02:44:51.862	SUBMIT
cmmikx9p900164o4a2c4af9f6	cmmikvfui000d4o4apwj0j5o4	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmikx9oq00124o4ao1u2kve5", "invoiceRef": "47556325", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://pay.example.com/preorders/cmmikvfui000d4o4apwj0j5o4?invoice=47556325", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmikvfui000d4o4apwj0j5o4/cmmikx9oq00124o4ao1u2kve5"}	2026-03-09 02:45:57.213	INVOICE
cmmin2hwh0005fzqtdfehwbk7	cmmin2hwc0003fzqtom2f5et1	Brouillon créé	{"fboId": "cmmin2hw30000fzqtyy0dsyje", "numeroFbo": "114-555-222-588", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 03:46:00.353	CREATE_DRAFT
cmmin2nuw000afzqtl9aeypap	cmmin2hwc0003fzqtom2f5et1	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 1}	2026-03-09 03:46:08.073	SET_ITEMS
cmmin2pon000ffzqtmnkoq04m	cmmin2hwc0003fzqtom2f5et1	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 1}	2026-03-09 03:46:10.44	SET_ITEMS
cmmin2t2r000ifzqteb4bmt5e	cmmin2hwc0003fzqtom2f5et1	Précommande soumise	{"totalFcfa": 65500, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-09 03:46:14.836	SUBMIT
cmmin3rct000pfzqtaohxkt3k	cmmin2hwc0003fzqtom2f5et1	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmin3rbz000lfzqtkzsw9qz1", "invoiceRef": "24578521", "paymentRef": "test_ZrAm1TUmbL", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://paydunya.com/sandbox-checkout/invoice/test_ZrAm1TUmbL", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmin2hwc0003fzqtom2f5et1/cmmin3rbz000lfzqtkzsw9qz1"}	2026-03-09 03:46:59.261	INVOICE
cmmin5bre000sfzqthkheqr39	cmmin2hwc0003fzqtom2f5et1	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_ZrAm1TUmbL", "paydunyaStatus": "completed"}	2026-03-09 03:48:12.362	VERIFY_PAYMENT
cmmj0cmnr0005147avl2wf9c3	cmmj0cmng0003147a0uuk27cz	Brouillon créé	{"fboId": "cmmj0cmmy0000147aqf8zn4j5", "numeroFbo": "225-000-101-219", "paymentMode": "ORANGE_MONEY", "deliveryMode": "LIVRAISON"}	2026-03-09 09:57:48.088	CREATE_DRAFT
cmmj0f7zu000a147a6qcy5ni6	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 27000, "itemsCount": 1}	2026-03-09 09:59:49.05	SET_ITEMS
cmmj0f98o000f147aee96emvz	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 27000, "itemsCount": 1}	2026-03-09 09:59:50.664	SET_ITEMS
cmmj0fgat000l147abn8qyn34	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 50500, "itemsCount": 2}	2026-03-09 09:59:59.814	SET_ITEMS
cmmj0fop6000s147am4z722gq	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 65500, "itemsCount": 3}	2026-03-09 10:00:10.699	SET_ITEMS
cmmj0gyhu0010147atsml38e0	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 72000, "itemsCount": 4}	2026-03-09 10:01:10.051	SET_ITEMS
cmmj0h1uj0018147agucdowjy	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 72000, "itemsCount": 4}	2026-03-09 10:01:14.395	SET_ITEMS
cmmj0howv001g147at3onl2yu	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 95500, "itemsCount": 4}	2026-03-09 10:01:44.288	SET_ITEMS
cmmj0hueq001o147aaykexjb6	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 121500, "itemsCount": 4}	2026-03-09 10:01:51.41	SET_ITEMS
cmmj0i1j7001w147auo8h0cin	cmmj0cmng0003147a0uuk27cz	Panier mis à jour	{"totalFcfa": 121500, "itemsCount": 4}	2026-03-09 10:02:00.643	SET_ITEMS
cmmj0ic9y001z147ap8h2qewi	cmmj0cmng0003147a0uuk27cz	Précommande soumise	{"totalFcfa": 121500, "itemsCount": 4, "whatsappTo": "+2250506025071"}	2026-03-09 10:02:14.566	SUBMIT
cmmj0kd5x0026147akbsy6aa0	cmmj0cmng0003147a0uuk27cz	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmj0kd460022147a4cmlz11k", "invoiceRef": "PF-2026-UK27CZ", "paymentRef": "test_uXlb1WKg8u", "whatsappTo": "+2250506025071", "paymentMode": "ORANGE_MONEY", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://paydunya.com/sandbox-checkout/invoice/test_uXlb1WKg8u", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmj0cmng0003147a0uuk27cz/cmmj0kd460022147a4cmlz11k"}	2026-03-09 10:03:49.03	INVOICE
cmmj0of5o0029147a0gfhe4zw	cmmj0cmng0003147a0uuk27cz	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_uXlb1WKg8u", "paydunyaStatus": "completed"}	2026-03-09 10:06:58.237	VERIFY_PAYMENT
cmmj3b39j000afngvl2aqpkqi	cmmj0cmng0003147a0uuk27cz	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-09 11:20:35.143	PREPARE
cmmj3d2tg000dfngv7kb5uz18	cmmj0cmng0003147a0uuk27cz	Commande clôturée	{"toStatus": "FULFILLED", "fromStatus": "READY", "deliveryTracking": null}	2026-03-09 11:22:07.876	FULFILL
cmmj4dnv3000510c2vslox3em	cmmj4dnuz000310c22dko6wk9	Brouillon créé	{"fboId": "cmm0rj83l0003jq7po4cm7gzm", "numeroFbo": "225-000-381-749", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 11:50:34.768	CREATE_DRAFT
cmmj4e8jh000a10c2337ip7ai	cmmj4dnuz000310c22dko6wk9	Panier mis à jour	{"totalFcfa": 5000, "itemsCount": 1}	2026-03-09 11:51:01.565	SET_ITEMS
cmmj4eepc000g10c2k5o78u6z	cmmj4dnuz000310c22dko6wk9	Panier mis à jour	{"totalFcfa": 27000, "itemsCount": 2}	2026-03-09 11:51:09.552	SET_ITEMS
cmmj4eki1000n10c29nrpkjwv	cmmj4dnuz000310c22dko6wk9	Panier mis à jour	{"totalFcfa": 40000, "itemsCount": 3}	2026-03-09 11:51:17.065	SET_ITEMS
cmmj4evwh000u10c2b1dir37o	cmmj4dnuz000310c22dko6wk9	Panier mis à jour	{"totalFcfa": 40000, "itemsCount": 3}	2026-03-09 11:51:31.842	SET_ITEMS
cmmj4u96b000x10c2u0nxzdlo	cmmj4dnuz000310c22dko6wk9	Précommande soumise	{"totalFcfa": 40000, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-09 12:03:28.884	SUBMIT
cmmj4vfln001410c22emnl4a9	cmmj4dnuz000310c22dko6wk9	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmj4vfku001010c25lh5bvjs", "invoiceRef": "PF-2026-KO6WK9", "paymentRef": "test_9N0BWxTLUw", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://paydunya.com/sandbox-checkout/invoice/test_9N0BWxTLUw", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmj4dnuz000310c22dko6wk9/cmmj4vfku001010c25lh5bvjs"}	2026-03-09 12:04:23.868	INVOICE
cmmj4wgkj001710c26uy45pw1	cmmj4dnuz000310c22dko6wk9	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_9N0BWxTLUw", "paydunyaStatus": "completed"}	2026-03-09 12:05:11.78	VERIFY_PAYMENT
cmmj4xj2c001g10c2jjabipz3	cmmj4dnuz000310c22dko6wk9	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-09 12:06:01.668	PREPARE
cmmj4ytwq001j10c2vbuy0qe7	cmmj4dnuz000310c22dko6wk9	Commande clôturée	{"toStatus": "FULFILLED", "fromStatus": "READY", "deliveryTracking": null}	2026-03-09 12:07:02.378	FULFILL
cmmjb494j0005xm3tqio8xkjr	cmmjb494e0003xm3tbt47lghg	Brouillon créé	{"fboId": "cmmjb49440000xm3t4qcf1exu", "numeroFbo": "225-000-129-990", "paymentMode": "WAVE", "deliveryMode": "LIVRAISON"}	2026-03-09 14:59:13.076	CREATE_DRAFT
cmmjb5gkg000axm3t0kndlszh	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 23000, "itemsCount": 1}	2026-03-09 15:00:09.376	SET_ITEMS
cmmjb5j6b000fxm3tk99hw353	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 46000, "itemsCount": 1}	2026-03-09 15:00:12.756	SET_ITEMS
cmmjb5k9q000kxm3ti3wk9cs5	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 46000, "itemsCount": 1}	2026-03-09 15:00:14.174	SET_ITEMS
cmmjb5lmc000pxm3tszzidef7	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 68000, "itemsCount": 1}	2026-03-09 15:00:15.925	SET_ITEMS
cmmjb5mu1000uxm3turbjhi1q	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 68000, "itemsCount": 1}	2026-03-09 15:00:17.497	SET_ITEMS
cmmjb5osy000zxm3tzc0pmezr	cmmjb494e0003xm3tbt47lghg	Panier mis à jour	{"totalFcfa": 68000, "itemsCount": 1}	2026-03-09 15:00:20.051	SET_ITEMS
cmmjb5zbx0012xm3t7d71c7mn	cmmjb494e0003xm3tbt47lghg	Précommande soumise	{"totalFcfa": 68000, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-09 15:00:33.694	SUBMIT
cmmjb7xiv0019xm3t6xeorsaa	cmmjb494e0003xm3tbt47lghg	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmjb7xi80015xm3tbb4h311a", "invoiceRef": "27302", "paymentRef": "test_Y1WF00nLXR", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://paydunya.com/sandbox-checkout/invoice/test_Y1WF00nLXR", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmjb494e0003xm3tbt47lghg/cmmjb7xi80015xm3tbb4h311a"}	2026-03-09 15:02:04.663	INVOICE
cmmjbc4ly001cxm3tuq04t7op	cmmjb494e0003xm3tbt47lghg	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_Y1WF00nLXR", "paydunyaStatus": "completed"}	2026-03-09 15:05:20.47	VERIFY_PAYMENT
cmmjbll9q001hxm3tsb7fi6j3	cmmjb494e0003xm3tbt47lghg	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-09 15:12:41.966	PREPARE
cmmjifs7h000570gm10dzfter	cmmjifs74000370gmb4ysyc2h	Brouillon créé	{"fboId": "cmmjifs6t000070gmlapg8lag", "numeroFbo": "225-443-233-345", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-09 18:24:08.334	CREATE_DRAFT
cmmkjkrww0005npuz2qm98diq	cmmkjkrws0003npuzq2edy64n	Brouillon créé	{"fboId": "cmmkjkrwj0000npuzrbhsy211", "numeroFbo": "225-000-865-453", "paymentMode": "WAVE", "deliveryMode": "LIVRAISON"}	2026-03-10 11:43:47.024	CREATE_DRAFT
cmmkmt0bo000515hlxzj238lv	cmmkmt0bi000315hlrl8sms8j	Brouillon créé	{"fboId": "cmmkmt0ao000015hlc4dinm4u", "numeroFbo": "345-533-356-688", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 13:14:10.02	CREATE_DRAFT
cmmkqosk400055ihuudru9cm5	cmmkqosja00035ihu0tbq9luy	Brouillon créé	{"fboId": "cmmkqosj100005ihug3dc1gq7", "numeroFbo": "225-000-324-365", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 15:02:51.796	CREATE_DRAFT
cmmkqw4my000b5ihunyf9b09r	cmmkqw4mt00095ihubgi7ul0z	Brouillon créé	{"fboId": "cmmkqw4mm00065ihucof95z6s", "numeroFbo": "225-000-066-453", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 15:08:34.043	CREATE_DRAFT
cmmkra2lx000h5ihuyjv74o8e	cmmkra2lh000f5ihu7lynpaty	Brouillon créé	{"fboId": "cmmkra2l4000c5ihutebwajl6", "numeroFbo": "222-232-343-545", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 15:19:24.597	CREATE_DRAFT
cmmkracrz000m5ihu36wja7z3	cmmkra2lh000f5ihu7lynpaty	Panier mis à jour	{"totalFcfa": 103950, "itemsCount": 1}	2026-03-10 15:19:37.776	SET_ITEMS
cmmkraer8000r5ihu7r95g5ke	cmmkra2lh000f5ihu7lynpaty	Panier mis à jour	{"totalFcfa": 103950, "itemsCount": 1}	2026-03-10 15:19:40.34	SET_ITEMS
cmmkraoi0000u5ihuci7recac	cmmkra2lh000f5ihu7lynpaty	Précommande soumise	{"totalFcfa": 103950, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-10 15:19:52.968	SUBMIT
cmmkrfi3q00105ihuixiam8wr	cmmkrfi2w000y5ihut1oggkt9	Brouillon créé	{"fboId": "cmmkrfi1z000v5ihukcxk41qm", "numeroFbo": "225-000-145-369", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 15:23:37.959	CREATE_DRAFT
cmmkrg1fd00155ihu6ytg630s	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 11700, "itemsCount": 1}	2026-03-10 15:24:03.001	SET_ITEMS
cmmkrg55e001b5ihun9iblhh5	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 18000, "itemsCount": 2}	2026-03-10 15:24:07.827	SET_ITEMS
cmmkrg7ad001i5ihukp05zio8	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 23850, "itemsCount": 3}	2026-03-10 15:24:10.598	SET_ITEMS
cmmkrgagx001q5ihubnlao52h	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 38250, "itemsCount": 4}	2026-03-10 15:24:14.721	SET_ITEMS
cmmkrgcoc001z5ihu4of0m21e	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 41400, "itemsCount": 5}	2026-03-10 15:24:17.58	SET_ITEMS
cmmkrgi6j00285ihuu933unxm	cmmkrfi2w000y5ihut1oggkt9	Panier mis à jour	{"totalFcfa": 41400, "itemsCount": 5}	2026-03-10 15:24:24.715	SET_ITEMS
cmmkrgooh002b5ihuonhmkbuw	cmmkrfi2w000y5ihut1oggkt9	Précommande soumise	{"totalFcfa": 41400, "itemsCount": 5, "whatsappTo": "+2250506025071"}	2026-03-10 15:24:33.137	SUBMIT
cmmkrhq16002h5ihu811kiakb	cmmkrhq11002f5ihuu24uq0c1	Brouillon créé	{"fboId": "cmmkrhq0u002c5ihul9pswmmu", "numeroFbo": "225-000-254-147", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 15:25:21.546	CREATE_DRAFT
cmmkri39h002m5ihuqrw77jb7	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 36500, "itemsCount": 1}	2026-03-10 15:25:38.693	SET_ITEMS
cmmkri5k5002s5ihuda56nabh	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 41500, "itemsCount": 2}	2026-03-10 15:25:41.67	SET_ITEMS
cmmkri6rs002y5ihu7xme94ww	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 41500, "itemsCount": 2}	2026-03-10 15:25:43.241	SET_ITEMS
cmmkri8pr00345ihuaud6xh1i	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 41500, "itemsCount": 2}	2026-03-10 15:25:45.76	SET_ITEMS
cmmkricgo003a5ihu41esaicj	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 41500, "itemsCount": 2}	2026-03-10 15:25:50.616	SET_ITEMS
cmmkrie56003h5ihuk5df6jcu	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 66500, "itemsCount": 3}	2026-03-10 15:25:52.794	SET_ITEMS
cmmkriffy003o5ihulv1pizxl	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 66500, "itemsCount": 3}	2026-03-10 15:25:54.479	SET_ITEMS
cmmkrihaw003v5ihut49i25hw	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 66500, "itemsCount": 3}	2026-03-10 15:25:56.888	SET_ITEMS
cmmkrijhu00425ihu5wqgu7x7	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 66500, "itemsCount": 3}	2026-03-10 15:25:59.731	SET_ITEMS
cmmkrildf004a5ihurucumo9d	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 93000, "itemsCount": 4}	2026-03-10 15:26:02.163	SET_ITEMS
cmmkrito5004j5ihu5kb47394	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 119000, "itemsCount": 5}	2026-03-10 15:26:12.917	SET_ITEMS
cmmkrj0ov00535ihu2chm7cim	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 145500, "itemsCount": 6}	2026-03-10 15:26:22.015	SET_ITEMS
cmmkrj9ry00565ihulxmq2fcc	cmmkrhq11002f5ihuu24uq0c1	Précommande soumise	{"totalFcfa": 145500, "itemsCount": 6, "whatsappTo": "+2250506025071"}	2026-03-10 15:26:33.79	SUBMIT
cmmkrix3i004t5ihuoyzygupq	cmmkrhq11002f5ihuu24uq0c1	Panier mis à jour	{"totalFcfa": 145500, "itemsCount": 6}	2026-03-10 15:26:17.358	SET_ITEMS
cmmkvsimy0005hugc3joba6uh	cmmkvsims0003hugckpy9kv0b	Brouillon créé	{"fboId": "cmmkvsimk0000hugcxvw0azgq", "numeroFbo": "225-000-169-850", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 17:25:43.642	CREATE_DRAFT
cmmkvtg11000bhugcd1m7w160	cmmkvtg0y0009hugczze7p9ob	Brouillon créé	{"fboId": "cmmkvtg0q0006hugcc81m9gdf", "numeroFbo": "226-000-765-899", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 17:26:26.918	CREATE_DRAFT
cmmkvult2000hhugchagsz5uz	cmmkvulsz000fhugc77x7qgt7	Brouillon créé	{"fboId": "cmmkvulsq000chugc1ajszx3j", "numeroFbo": "225-007-485-953", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 17:27:21.063	CREATE_DRAFT
cmmkw0npg000nhugcugaff7me	cmmkw0np7000lhugchbuaxag8	Brouillon créé	{"fboId": "cmmkw0nni000ihugc5ln9qis8", "numeroFbo": "225-000-745-896", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 17:32:03.46	CREATE_DRAFT
cmmkyoi8y000f4fmm0hnp1ihm	cmmkyoi8n000d4fmmlfjumyhp	Brouillon créé	{"fboId": "cmmkyoi8a000a4fmm2iuxhdk2", "numeroFbo": "226-000-123-432", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 18:46:35.362	CREATE_DRAFT
cmml67lxe0005nfmenbj2s8f9	cmml67lwu0003nfmehe75h6mp	Brouillon créé	{"fboId": "cmml67lvn0000nfmeb32io2k4", "numeroFbo": "226-147-852-963", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 22:17:23.906	CREATE_DRAFT
cmml6xrpl0004ypqmw3yzm4sg	cmml67lwu0003nfmehe75h6mp	Panier mis à jour	{"totalFcfa": 28800, "itemsCount": 1}	2026-03-10 22:37:44.457	SET_ITEMS
cmml6xupa000aypqm8svqnry1	cmml67lwu0003nfmehe75h6mp	Panier mis à jour	{"totalFcfa": 48600, "itemsCount": 2}	2026-03-10 22:37:48.335	SET_ITEMS
cmml6xxtt000gypqmrefah6ow	cmml67lwu0003nfmehe75h6mp	Panier mis à jour	{"totalFcfa": 48600, "itemsCount": 2}	2026-03-10 22:37:52.385	SET_ITEMS
cmml6z3jw000mypqmgo42pb2v	cmml67lwu0003nfmehe75h6mp	Panier mis à jour	{"totalFcfa": 48600, "itemsCount": 2}	2026-03-10 22:38:46.461	SET_ITEMS
cmml6z70a000pypqm8hlj6jee	cmml67lwu0003nfmehe75h6mp	Précommande soumise	{"totalFcfa": 48600, "itemsCount": 2, "whatsappTo": "+2250506025071"}	2026-03-10 22:38:50.939	SUBMIT
cmml7uy0j0005a915esageo9s	cmml7uy0e0003a9157u2zj2u0	Brouillon créé	{"fboId": "cmml7uy060000a915ohprxtpg", "numeroFbo": "114-523-669-874", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 23:03:32.275	CREATE_DRAFT
cmml8ngzf001za915rugq6kb7	cmml8ngz8001xa915uw1nlain	Brouillon créé	{"fboId": "cmml8ngyv001ua915nslfp0vm", "numeroFbo": "226-000-777-589", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-10 23:25:43.228	CREATE_DRAFT
cmml8nsmp0024a9157n895piq	cmml8ngz8001xa915uw1nlain	Panier mis à jour	{"totalFcfa": 60060, "itemsCount": 1}	2026-03-10 23:25:58.321	SET_ITEMS
cmml8nvpv0029a915q7ecmlls	cmml8ngz8001xa915uw1nlain	Panier mis à jour	{"totalFcfa": 60060, "itemsCount": 1}	2026-03-10 23:26:02.324	SET_ITEMS
cmml8o6bg002ca915bc0s1337	cmml8ngz8001xa915uw1nlain	Précommande soumise	{"totalFcfa": 60060, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-10 23:26:16.061	SUBMIT
cmmlsagzf000512xyo0w0wd9i	cmmlsagxy000312xyntjpzq91	Brouillon créé	{"fboId": "cmmlsagxp000012xy22mudf47", "numeroFbo": "225-000-475-852", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-11 08:35:29.019	CREATE_DRAFT
cmmlsauvn000a12xy0lzodhu3	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 6760, "itemsCount": 1}	2026-03-11 08:35:47.028	SET_ITEMS
cmmlsax0f000g12xyqz0nr7tk	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 18200, "itemsCount": 2}	2026-03-11 08:35:49.792	SET_ITEMS
cmmlsazql000n12xyfvsk7yua	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 29640, "itemsCount": 3}	2026-03-11 08:35:53.325	SET_ITEMS
cmmlsb2gu000v12xyeolrmmwq	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 32240, "itemsCount": 4}	2026-03-11 08:35:56.862	SET_ITEMS
cmmlsb4nt001412xy1jqvo8sd	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 54340, "itemsCount": 5}	2026-03-11 08:35:59.706	SET_ITEMS
cmmlsbcql001e12xypyrtindc	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 114400, "itemsCount": 6}	2026-03-11 08:36:10.174	SET_ITEMS
cmmlsbi92001o12xykgsbc642	cmmlsagxy000312xyntjpzq91	Panier mis à jour	{"totalFcfa": 114400, "itemsCount": 6}	2026-03-11 08:36:17.319	SET_ITEMS
cmmlsbraz001r12xyipv03wof	cmmlsagxy000312xyntjpzq91	Précommande soumise	{"totalFcfa": 114400, "itemsCount": 6, "whatsappTo": "+2250506025071"}	2026-03-11 08:36:29.051	SUBMIT
cmmm1653z0005hxjggqe8wxmh	cmmm1653u0003hxjgjcjssh1q	Brouillon créé	{"fboId": "cmmm1653l0000hxjg148po5i4", "numeroFbo": "222-555-567-789", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-11 12:44:03.552	CREATE_DRAFT
cmmm1hgdk000bhxjg9013qjh6	cmmm1hgdf0009hxjg57wtgvk1	Brouillon créé	{"fboId": "cmmm1hgd70006hxjgv0g727i4", "numeroFbo": "225-000-123-445", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-11 12:52:51.368	CREATE_DRAFT
cmmm1hre1000ghxjgrvktoo1h	cmmm1hgdf0009hxjg57wtgvk1	Panier mis à jour	{"totalFcfa": 13500, "itemsCount": 1}	2026-03-11 12:53:05.642	SET_ITEMS
cmmm1hsvv000mhxjgl4n3843s	cmmm1hgdf0009hxjg57wtgvk1	Panier mis à jour	{"totalFcfa": 33300, "itemsCount": 2}	2026-03-11 12:53:07.579	SET_ITEMS
cmmm1hv7i000thxjgub5e6ehf	cmmm1hgdf0009hxjg57wtgvk1	Panier mis à jour	{"totalFcfa": 53100, "itemsCount": 3}	2026-03-11 12:53:10.59	SET_ITEMS
cmmm1i8l10010hxjg8nval5wo	cmmm1hgdf0009hxjg57wtgvk1	Panier mis à jour	{"totalFcfa": 53100, "itemsCount": 3}	2026-03-11 12:53:27.925	SET_ITEMS
cmmm1k0890016hxjgsjsrom6e	cmmm1k0830014hxjg53foxruc	Brouillon créé	{"fboId": "cmmm1k07w0011hxjg6ort8bdj", "numeroFbo": "225-000-145-677", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-11 12:54:50.41	CREATE_DRAFT
cmmm1k7hq001bhxjgaunfw9b0	cmmm1k0830014hxjg53foxruc	Panier mis à jour	{"totalFcfa": 13500, "itemsCount": 1}	2026-03-11 12:54:59.823	SET_ITEMS
cmmm1k93i001hhxjgpki5nnxx	cmmm1k0830014hxjg53foxruc	Panier mis à jour	{"totalFcfa": 33300, "itemsCount": 2}	2026-03-11 12:55:01.903	SET_ITEMS
cmmm1kayy001ohxjg8nvljv6c	cmmm1k0830014hxjg53foxruc	Panier mis à jour	{"totalFcfa": 39150, "itemsCount": 3}	2026-03-11 12:55:04.33	SET_ITEMS
cmmm1kcoi001whxjgzve0i5ie	cmmm1k0830014hxjg53foxruc	Panier mis à jour	{"totalFcfa": 50850, "itemsCount": 4}	2026-03-11 12:55:06.547	SET_ITEMS
cmmm1kio80024hxjgwjpt1tgf	cmmm1k0830014hxjg53foxruc	Panier mis à jour	{"totalFcfa": 50850, "itemsCount": 4}	2026-03-11 12:55:14.312	SET_ITEMS
cmmm1kz130027hxjgeo0pd3z8	cmmm1k0830014hxjg53foxruc	Précommande soumise	{"totalFcfa": 50850, "itemsCount": 4, "whatsappTo": "+2250506025071"}	2026-03-11 12:55:35.512	SUBMIT
cmmm1n8rm002ehxjgeg7xhgbl	cmmm1k0830014hxjg53foxruc	Précommande facturée et message WhatsApp envoyé.	{"actorName": "admin@forever.ci", "messageId": "cmmm1n8r1002ahxjgwrqevv67", "invoiceRef": "2454670", "paymentRef": "test_sWbMHiDuzV", "whatsappTo": "+2250506025071", "paymentMode": "WAVE", "messageStatus": "SENT", "messagePurpose": "PAYMENT_LINK", "paymentLinkTarget": "https://paydunya.com/sandbox-checkout/invoice/test_sWbMHiDuzV", "paymentLinkTracked": "https://appfbo-backend.onrender.com/pay/o/cmmm1k0830014hxjg53foxruc/cmmm1n8r1002ahxjgwrqevv67"}	2026-03-11 12:57:21.442	INVOICE
cmmm1qug9002hhxjgarx6tkn3	cmmm1k0830014hxjg53foxruc	Paiement confirmé automatiquement par PayDunya	{"toStatus": "PAID", "fromStatus": "INVOICED", "paymentRef": "test_sWbMHiDuzV", "paydunyaStatus": "completed"}	2026-03-11 13:00:09.513	VERIFY_PAYMENT
cmmm1ttfj002shxjgh2jm2tjb	cmmm1k0830014hxjg53foxruc	Colis prêt	{"toStatus": "READY", "fromStatus": "PAID", "stockDeducted": true}	2026-03-11 13:02:28.159	PREPARE
cmmm1vek1002vhxjghdlnmb2w	cmmm1k0830014hxjg53foxruc	Commande clôturée	{"toStatus": "FULFILLED", "fromStatus": "READY", "deliveryTracking": null}	2026-03-11 13:03:42.193	FULFILL
cmmn4pvjn0005scfqalqnvot0	cmmn4pvjj0003scfq8uuqywau	Brouillon créé	{"fboId": "cmmfk13u4000nqpo5rre2f569", "numeroFbo": "225-000-145-236", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 07:11:09.3	CREATE_DRAFT
cmmnbair20005a8852cdfg3zz	cmmnbaiqx0003a885aom49f18	Brouillon créé	{"fboId": "cmmnbaiqe0000a885d2frj8mr", "numeroFbo": "225-000-125-478", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 10:15:10.191	CREATE_DRAFT
cmmnbtn4q000aa885ht4cwntq	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 109725, "itemsCount": 1}	2026-03-12 10:30:02.331	SET_ITEMS
cmmnbtqbw000ea885r58xvlsh	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-12 10:30:06.477	SET_ITEMS
cmmnbts4h000ia885b4lfgxxw	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-12 10:30:08.801	SET_ITEMS
cmmnbtt1l000ma885fixmiv4v	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-12 10:30:09.994	SET_ITEMS
cmmnbtu62000ra885auhc5l6w	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 4750, "itemsCount": 1}	2026-03-12 10:30:11.451	SET_ITEMS
cmmnbtwvl000xa885aj4pvjck	cmml7uy0e0003a9157u2zj2u0	Panier mis à jour	{"totalFcfa": 114475, "itemsCount": 2}	2026-03-12 10:30:14.961	SET_ITEMS
cmmnc5uxv0013a885j9m8oooa	cmmnc5uxr0011a885xkzn4zw2	Brouillon créé	{"fboId": "cmmnc5uxk000ya885q6516wws", "numeroFbo": "225-000-114-785", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 10:39:32.324	CREATE_DRAFT
cmmnc6nq70019a885vw9i55rl	cmmnc6nq40017a885lodpzsoz	Brouillon créé	{"fboId": "cmmnc6npx0014a885yw881qxw", "numeroFbo": "222-585-222-364", "paymentMode": "WAVE", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 10:40:09.631	CREATE_DRAFT
cmmncat5p001ea885ol9pyn7y	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 80850, "itemsCount": 1}	2026-03-12 10:43:23.293	SET_ITEMS
cmmncmivg001ia885okfbb8wv	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 0, "itemsCount": 0}	2026-03-12 10:52:29.837	SET_ITEMS
cmmncncrg001na885u9s3dcte	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 80850, "itemsCount": 1}	2026-03-12 10:53:08.573	SET_ITEMS
cmmncnfcy001sa885a4yf7285	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 80850, "itemsCount": 1}	2026-03-12 10:53:11.939	SET_ITEMS
cmmncnqs1001xa885bk6f6hez	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 161700, "itemsCount": 1}	2026-03-12 10:53:26.737	SET_ITEMS
cmmncnsfb0022a885w70fhrl3	cmmnc6nq40017a885lodpzsoz	Panier mis à jour	{"totalFcfa": 161700, "itemsCount": 1}	2026-03-12 10:53:28.871	SET_ITEMS
cmmncp6vo0025a8853knaf5rg	cmmnc6nq40017a885lodpzsoz	Précommande soumise	{"totalFcfa": 161700, "itemsCount": 1, "whatsappTo": "+2250506025071"}	2026-03-12 10:54:34.261	SUBMIT
cmmndbon30005d4k88d0dtcgc	cmmndbomy0003d4k8v76jcn1w	Brouillon créé	{"fboId": "cmmndbomp0000d4k8gd6kcjy4", "numeroFbo": "225-000-114-526", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 11:12:03.711	CREATE_DRAFT
cmmndck08000ad4k8bkkfmky5	cmmndbomy0003d4k8v76jcn1w	Panier mis à jour	{"totalFcfa": 14250, "itemsCount": 1}	2026-03-12 11:12:44.361	SET_ITEMS
cmmndcoqk000gd4k89o91wdrd	cmmndbomy0003d4k8v76jcn1w	Panier mis à jour	{"totalFcfa": 54625, "itemsCount": 2}	2026-03-12 11:12:50.493	SET_ITEMS
cmmndcrv6000md4k84w7g256f	cmmndbomy0003d4k8v76jcn1w	Panier mis à jour	{"totalFcfa": 54625, "itemsCount": 2}	2026-03-12 11:12:54.546	SET_ITEMS
cmmnddm1t000sd4k844hdztay	cmmnddm1p000qd4k804yjl4lt	Brouillon créé	{"fboId": "cmmnddm1h000nd4k88aerd7ey", "numeroFbo": "225-000-125-636", "paymentMode": "ESPECES", "deliveryMode": "RETRAIT_SITE_FLP"}	2026-03-12 11:13:33.665	CREATE_DRAFT
cmmnddu5y000xd4k8pv8ds02d	cmmnddm1p000qd4k804yjl4lt	Panier mis à jour	{"totalFcfa": 14820, "itemsCount": 1}	2026-03-12 11:13:44.182	SET_ITEMS
cmmnddxqn0013d4k87p2r80sf	cmmnddm1p000qd4k804yjl4lt	Panier mis à jour	{"totalFcfa": 35625, "itemsCount": 2}	2026-03-12 11:13:48.815	SET_ITEMS
cmmnde22o001ad4k8eh5vahak	cmmnddm1p000qd4k804yjl4lt	Panier mis à jour	{"totalFcfa": 50730, "itemsCount": 3}	2026-03-12 11:13:54.432	SET_ITEMS
cmmnde4i6001hd4k8s1nkicmr	cmmnddm1p000qd4k804yjl4lt	Panier mis à jour	{"totalFcfa": 50730, "itemsCount": 3}	2026-03-12 11:13:57.583	SET_ITEMS
cmmndede3001kd4k8xk5liebj	cmmnddm1p000qd4k804yjl4lt	Précommande soumise	{"totalFcfa": 50730, "itemsCount": 3, "whatsappTo": "+2250506025071"}	2026-03-12 11:14:09.1	SUBMIT
\.


--
-- Data for Name: Product; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."Product" (id, sku, nom, "imageUrl", "prixBaseFcfa", cc, "poidsKg", actif, "createdAt", "updatedAt", category, details, "stockQty", "countryId") FROM stdin;
cmm72nemy0004zax689z1yv51	559	Forever Exfoliator	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772328558/appfbo/products/559.png	16000	0.073	0.065	t	2026-03-01 01:28:56.007	2026-03-01 01:29:25.763	SOINS_DE_LA_PEAU	Ce soin conjugue exfoliation enzymatique et mécanique pour nettoyer la peau en profondeur. Le grain de peau est affiné et le teint unifié. \n\nCe soin allie efficacité et douceur pour vous permettre de faire peau neuve. Il conjugue exfoliation enzymatique (bromélaïne et papaïne) et mécanique (perles de jojoba et de bambou) pour désincruster les impuretés, tout en enveloppant la peau d’un voile protecteur grâce à de puissants actifs hydratants. Résultat un grain de peau affiné, une peau lisse et satinée.	100	country_ci_default
cmm72tmhn0005zax6saur1hb3	686	Forerver Vitamine C	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772328844/appfbo/products/686.png	42500	0.200	0.032	t	2026-03-01 01:33:46.137	2026-03-01 01:34:11.251	SOINS_DE_LA_PEAU	Forever Vitamin C™, sérum illuminateur, aide à raviver l’éclat de la peau. Sa formule associe 6% de vitamine C hautement stable et cliniquement testée, à l’Aloe vera et au jojoba nourrissants, pour une peau visiblement plus lumineuse, hydratée et rayonnante.	100	country_ci_default
cmm7l59n80000ms2kgsiklkiz	659	DX4	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772359655/appfbo/products/659.jpg	115500	0.533	2.000	t	2026-03-01 10:06:42.414	2026-03-01 10:08:07.29	COMBO_PACKS	Le DX4™ est un programme de quatre jours qui a pour objectif de vous aider à retrouver votre bien-être intérieur grâce à une association de sept produits qui agissent en synergie.\n\nLe DX4™ est un programme de quatre jours qui a pour objectif de vous aider à retrouver votre bien-être intérieur grâce à une association de compléments alimentaires qui contribuent au bon fonctionnement du métabolisme*, à l'hydratation** et à la satiété***. Les sept produits du DX4™ agissent en synergie pour retrouver un meilleur équilibre physique et émotionnel.\n\nAu cours de ce programme, vous démarrerez votre démarche vers plus de bien-être en maintenant votre niveau d'énergie et en optimisant votre alimentation. DX4™ est conçu pour vous aider à prendre soin de votre corps et à prendre conscience de la façon dont vous mangez.\n\nIl contient :\n\n4 x pulpe d’Aloe Vera (330 mL)\n1 x Forever Plant Protein™\nForever LemonBlast™  (4 sachets)\nForever Sensatiable™ (32 comprimés à croquer)\nForever Multi Fizz™ (4 comprimés effervescents)\nForever DuoPure™ (8 comprimés)\nForever Therm Plus™ (12 comprimés)	50	country_ci_default
cmlskeut70000xe14vqohvp3b	71	Garcinia Plus	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528787/appfbo/products/71.png	26000	0.120	0.051	t	2026-02-18 21:49:37.53	2026-02-27 04:57:51.208	GESTION_DE_POIDS	\N	100	country_ci_default
cmls45cyx000p6gu5zmxsbrs8	28	Forever Bright	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528226/appfbo/products/28.png	7000	0.032	0.050	t	2026-02-18 14:14:20.578	2026-02-28 10:34:04.696	SOINS_PERSONNELS	\N	98	country_ci_default
cmm2aq7af0003ie0a12ckessh	61	Gelée Aloès - Aloe Verra Gelly	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039781/appfbo/products/61.png	16000	0.059	0.100	t	2026-02-25 17:16:12.504	2026-02-28 11:21:25.581	SOINS_PERSONNELS	Riche en Aloe vera, ce gel transparent non gras protège contre le dessèchement causé par le soleil, rafraîchit la peau, hydrate intensément et régénère ainsi l’épiderme. \n\nParticulièrement riche en Aloe Vera, ce gel transparent non gras possède toutes les vertus de la plante. Il hydrate, apaise et régénère l'épiderme. Il est idéal contre les irritations superficielles de la peau et les agressions extérieures.\nExtrêmement proche du précieux mucilage de la plante, il contient 84,46% de gel naturel d'Aloe vera, la gelée bénéficie de toutes ses propriétés apaisantes, réparatrices et hydratantes. Son pH 5,5 doux et équilibrant est parfaitement toléré par toutes les peaux, même les plus sensibles.	100	country_ci_default
cmm2aezbm0001ie0aho49vah6	613	Forever Marine Collagene	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039265/appfbo/products/613.png	69000	0.327	0.300	t	2026-02-25 17:07:28.973	2026-02-28 10:32:58.746	NUTRITION	\N	100	country_ci_default
cmls38zg300046gu59fpffhug	196	Forever Freedom	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528281/appfbo/products/196.png	32000	0.146	1.000	t	2026-02-18 13:49:10.115	2026-03-08 17:44:39.168	BUVABLE	Forever Freedom est une boisson conçue pour accompagner un mode de vie actif et se réinvente avec une formule améliorée : une saveur d’agrumes naturelle aux notes fraîches de citron et d’orange, une composition sans crustacés et un format liquide pratique, idéal pour une consommation quotidienne.\n\nElle associe le gel d’aloe vera pur de Forever, extrait de la pulpe interne des feuilles, à trois ingrédients clés : le sulfate de glucosamine, le sulfate de chondroïtine et le méthylsulfonylméthane (MSM).	99	country_ci_default
cmm4fmlxz000113nm2tqerc8d	471	Forever Lite Ultra Chocolat	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772169476/appfbo/products/471.png	26500	0.122	0.375	t	2026-02-27 05:08:55.283	2026-03-08 17:44:39.205	GESTION_DE_POIDS	Pour garder la ligne, cet en-cas nutritif et savoureux, peut compléter un repas léger en apportant vitamines, minéraux protéines et carbo-hydrates. Forever ultra Lite Plus Chocolat contribue au maintien de la masse musculaire et participe au rendement normal du métabolisme énergétique.	99	country_ci_default
cmm2aajt70000ie0ay4rcf48m	215	Forever Multi-Maca	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039060/appfbo/products/215.png	23500	0.107	0.100	t	2026-02-25 17:04:02.171	2026-03-09 11:20:35.109	NUTRITION	\N	96	country_ci_default
cmls3r44r000d6gu58mrzo3rg	721	FAB - Forever Active Boost	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528289/appfbo/products/721.png	5000	0.019	0.282	t	2026-02-18 14:03:16.008	2026-03-09 12:06:01.648	BUVABLE	Obtenez le coup de pouce dont vous avez besoin pour affronter la journée avec FAB Forever Active Boost, qui contient des ingrédients contribuant à réduire la fatigue et à maintenir le fonctionnement normal du système immunitaire.\nElle se consomme à tout moment de la journée pour stimuler votre énergie physique et intellectuelle que vous soyez étudiant, sportif  avant ou après un effort et à tous ceux qui ont besoin d’un coup de boost !	99	country_ci_default
cmls3z93h000n6gu5snuggrfj	375	Vitolize Women	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528257/appfbo/products/375.png	26000	0.127	0.100	t	2026-02-18 14:09:35.691	2026-02-28 23:42:21.63	NUTRITION	\N	99	country_ci_default
cmls4mrox00186gu5y2qefgjv	22	Forever Aloe Lips	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528850/appfbo/products/22.png	3500	0.014	0.010	t	2026-02-18 14:27:52.864	2026-02-28 10:32:35.051	SOINS_PERSONNELS	\N	100	country_ci_default
cmls2milw00006gu58tacyuar	504	Forever ARGI+ Sticks pack	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528343/appfbo/products/504.png	65500	0.303	0.350	t	2026-02-18 13:31:41.873	2026-02-28 10:30:37.463	NUTRITION	\N	98	country_ci_default
cmm70v5ee0000zax67s0mr3lr	676	Forever AloeTurm	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772325627/appfbo/products/676.png	6000	0.026	0.015	t	2026-03-01 00:38:58.071	2026-03-01 00:41:26.444	NUTRITION	Tous les bienfaits du curcuma provenant d'Inde et du zinc concentrés dans une pastille hydrogel innovante à la menthe qui fond dans la bouche, pour un bien-être global au quotidien.	100	country_ci_default
cmm7npn3v0001ti15f0bm4ir3	548	Programme C9 - Vanille	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772363929/appfbo/products/548.png	104500	0.482	1.500	t	2026-03-01 11:18:32.25	2026-03-01 11:19:05.513	COMBO_PACKS	Le C9™ s’effectue sur 9 jours pour purifier son organisme en éliminant les toxines. Les résultats apparaissent dès les premiers jours : perte de poids, sensation de légèreté et énergie retrouvée. Existe aussi en saveur Chocolat.	50	country_ci_default
cmmdgrtsp0001ly5t5patyv1v	65	Forever Ail et Thym	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772715817/appfbo/products/65.png	16000	0.072	0.040	t	2026-03-05 12:50:53.976	2026-03-05 13:57:50.312	NUTRITION	Forever Ail et Thym est une association unique de 2 extraits de plantes. Capsule sans odeur.	95	country_ci_default
cmm3sfz5l00012efon35ckxa9	716	Pulpe d'Aloes - 33ml	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772130017/appfbo/products/716.png	7000	0.030	0.350	t	2026-02-26 18:19:54.68	2026-02-28 23:41:16.381	BUVABLE	Elaborée à partir de feuilles entières récoltées et décortiquées à la main, la pulpe d'Aloe vera est concentrée à 99.7%. L’Aloe vera contribue au fonctionnement normal du système immunitaire. Source d’antioxydants, il protège les cellules et tissus de l’oxydation. Grâce à sa richesse en vitamine C, cette formule contribue à réduire la fatigue et participe au maintien du métabolisme énergétique.	100	country_ci_default
cmm2ahxf10002ie0afqpgkxtv	463	Forever Therm	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772039400/appfbo/products/463.png	25000	0.114	0.100	t	2026-02-25 17:09:46.458	2026-02-27 05:02:43.336	GESTION_DE_POIDS	Forever Therm™ aide à maintenir et contrôler le poids ainsi que la réduction des corps gras grâce notamment au thé vert qu'il contient. \n\nLa thermogenèse est un procédé naturel de production de chaleur par l’organisme qui est activé par le métabolisme cellulaire. En stimulant le métabolisme cellulaire pour produire de la chaleur, le corps va être amené à puiser dans ses réserves de graisses stockées pour produire l'énergie nécessaire à la génération de chaleur. Ainsi, ces graisses seront éliminées et transformées en énergie.\n\nForever Therm™ est formulé à partir d'extraits de plantes (thé vert, café vert, guarana) associés à des vitamines. Le thé vert aide à maintenir et à contrôler le poids, à accroître l’oxydation des graisses et à réduire les corps gras. La caféine contenue dans le guarana aide à améliorer la concentration et la vitamine C contribue à réduire la fatigue.	100	country_ci_default
cmm4fjl05000013nmu3z26lrm	470	Forever Lite Ultra Vanille	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772170106/appfbo/products/470.png	26500	0.123	0.375	t	2026-02-27 05:06:34.133	2026-02-27 05:28:36.987	GESTION_DE_POIDS	Pour garder la ligne, cet en-cas nutritif savoureux, riche en protéines, peut compléter un repas léger en apportant vitamines, minéraux, protéines et glucides. Forever Lite Ultra™ Vanille contribue au maintien de la masse musculaire et participe au rendement normal du métabolisme énergétique.	100	country_ci_default
cmm3gzb13000013oe3tfxqopm	207	Forever Bee Honey	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772110753/appfbo/products/207.png	15500	0.070	0.500	t	2026-02-26 12:59:01.127	2026-02-28 22:39:04.751	PRODUIT_DE_LA_RUCHE	Le miel, aussi appelé “or de la ruche”, est produit par les abeilles à partir du nectar des fleurs. Forever Miel est un miel pur récolté en montagne.\n\nLe Miel Forever Bee Honey™ est un super aliment qui concentre la richesse botanique de l’environnement dont il est issu. En montagne, les abeilles tirent profit d’une nature plus préservée et moins polluée pour en faire un miel d’exception.	50	country_ci_default
cmm4h43xy000413nmluqqbwmt	36	Gelée Royale Forever	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171539/appfbo/products/36.png	28500	0.130	0.034	t	2026-02-27 05:50:31.413	2026-02-28 22:39:04.751	PRODUIT_DE_LA_RUCHE	La gelée royale est le produit le plus précieux de la ruche. Sécrétée par les jeunes abeilles, elle transforme en quelques jours une larve en reine. \n\nLa Gelée Royale, sécrétée par les abeilles nourricières vers le 15ème jour de leur vie est exclusivement destinée à la reine des abeilles, c’est un « super-aliment ». Sa composition, encore plus riche que celle du miel, fait de Forever Royal Jelly un complément alimentaire particulièrement nutritif pour l’homme. \nIl contient plus de 100 éléments vitaux pour l’organisme. Il est riche en protéines, en vitamines dont les A, C, D et E et la majorité des vitamines B, ainsi qu’en minéraux et oligo-éléments tels que le cuivre, le soufre et le silicium.	100	country_ci_default
cmm4gkrkv000213nmqlseecgo	520	Forever Fast Break Bar	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772170561/appfbo/products/520.png	5000	0.021	0.056	t	2026-02-27 05:35:28.911	2026-02-27 07:22:39.428	GESTION_DE_POIDS	Forever Fast Break™ est une barre énergétique à la délicieuse saveur beurre de cacahuète. Source de glucides, mais aussi de vitamines et de minéraux, ce concentré de nutriments sera l’allié idéal des sportifs. En effet, sa composition unique permet une libération d’énergie en deux temps : tout d’abord immédiate puis graduelle. Effet coup de fouet assuré ! Elle sera tout aussi utile dans un sac à main ou le tiroir du bureau pour éviter les fringales et surmonter les coups de barre.	100	country_ci_default
cmls3gfzc000b6gu5o4loeinr	15	Pulpe - Aloe Vera Gel - 1L	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528237/appfbo/products/15.png	22000	0.100	1.000	t	2026-02-18 13:54:57.975	2026-02-28 11:19:54.274	BUVABLE	Elaborée à partir de feuilles entières récoltées et décortiquées à la main, la pulpe d'Aloe vera est concentrée à 99.7%. L’Aloe vera contribue au fonctionnement normal du système immunitaire. Source d’antioxydants, il protège les cellules et tissus de l’oxydation. Grâce à sa richesse en vitamine C, cette formule contribue à réduire la fatigue et participe au maintien du métabolisme énergétique.	100	country_ci_default
cmls4ot9e00196gu5susrhq13	564	Aloe Heat Lotion	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528857/appfbo/products/564.png	13000	0.060	0.030	t	2026-02-18 14:29:28.225	2026-03-11 13:02:28.057	SOINS_PERSONNELS	\N	48	country_ci_default
cmm4gzxqr000313nmlz6wd73f	27	Forever Bee Propolis	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171263/appfbo/products/27.png	28480	0.130	0.043	t	2026-02-27 05:47:16.74	2026-02-28 22:39:04.751	PRODUIT_DE_LA_RUCHE	La propolis est une résine collectée et métabolisée par les abeilles mellifères à partir des arbres et utilisée pour protéger la ruche.	100	country_ci_default
cmm4hb1nb000513nm1ckwxdga	26	Forever Bee Pollen	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772171817/appfbo/products/26.png	13000	0.060	0.060	t	2026-02-27 05:55:55.03	2026-02-28 22:39:04.751	PRODUIT_DE_LA_RUCHE	Collecté sur les fleurs par les abeilles, le pollen améliore leur vitalité et leur résistance tout au long de leurs vies.\n\nForever Bee Pollen contient du pollen d'abeille pur et du miel pour une combinaison idéale provenant directement de la ruche ! Le pollen est considéré comme l'aliment le plus complet de la nature. \n\nEn volant de fleur en fleur, les abeilles pollinisent les plantes et alimentent notre écosystème. Elles utilisent le pollen qu'elles récoltent pour créer leur nourriture, ce qui maintient toute la ruche nourrie, productive et forte. Le pollen améliore leur vitalité et leur résistance.	100	country_ci_default
cmm7nku740000ti15y49ujk3n	459	Vital-5 Freedom	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772363711/appfbo/products/459.png	262000	1.209	1.500	t	2026-03-01 11:14:47.981	2026-03-01 11:15:20.91	COMBO_PACKS	Vital5™ contient les 5 produits essentiels de Forever pour garantir un bien-être au quotidien. Les actifs de ces produits agissent en synergie pour rétablir l’équilibre de la flore intestinale. Ainsi l’absorption des nutriments est optimisée ainsi que l’élimination des toxines.	50	country_ci_default
cmmdgxa760003ly5tmy7b2m6c	376	Forever Artic Sea	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772715349/appfbo/products/376.png	26000	0.120	0.080	t	2026-03-05 12:55:08.512	2026-03-05 13:57:50.315	NUTRITION	Forever Arctic-Sea™ contient des acides gras insaturés, des oméga-3. Le DHA contribue au fonctionnement normal du cerveau et aide à maintenir une vision normale. L'EPA et DHA contribuent à une fonction normale du coeur.	90	country_ci_default
cmls3i2ka000c6gu5r0tuvg0x	34	Aloe Berry Nectar	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528087/appfbo/products/34.png	22000	0.100	1.000	t	2026-02-18 13:56:14.073	2026-03-11 13:02:27.905	BUVABLE	Nouvelle bouteille PET 100% recyclable !\nUne dose généreuse d’Aloe vera et un soupçon de jus de pomme et de canneberge est l’alliance idéale. L’Aloe vera aide à stimuler le métabolisme. Riche en vitamine C, cette formule apporte une dose synergique d’antioxydants favorisant la protection des cellules contre le stress oxydatif.\n\nUne large dose (90,7%) de pulpe d'Aloe vera, un soupçon de jus de pomme et de canneberge, de la vitamine C, aucun conservateur et un emballage 100% recyclable. Et voilà le secret de la toute nouvelle formule de l'Aloe Berry Nectar. Retrouvez notre Aloe vera au coeur d'une formule au goût acidulé, pour un plaisir sain et toujours autant de bien-être.	95	country_ci_default
cmlskghjo0001xe143p8q80fd	289	Forever Lean	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528813/appfbo/products/289.png	36500	0.167	0.050	t	2026-02-18 21:50:53.651	2026-03-08 17:44:39.2	GESTION_DE_POIDS	Forever Lean™ est un complément alimentaire à base de feuilles de Neopuntia, de graines de haricot sec et de chrome. Le chrome qui contribue à maintenir un taux normal de glucose sanguin et participe au métabolisme normal des macronutriments.	99	country_ci_default
cmls3x9x5000m6gu5k6l06mvb	374	Vitolize Men	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528266/appfbo/products/374.png	26000	0.120	0.100	t	2026-02-18 14:08:03.339	2026-03-09 11:20:35.079	NUTRITION	Vitolize Hommes contient des vitamines et des minéraux, ainsi que des phytostérols issus de l’huile de pépins de courge pour conserver un bon fonctionnement de la prostate. Le zinc présent dans Vitolize Hommes contribue au maintien normal de la fertilité, de la reproduction et du taux de testostérone dans le sang. La vitamine B6 qu’il renferme permet de réguler l’activité hormonale et le sélénium favorise une spermatogénèse normale.	96	country_ci_default
cmm3s6a9300002efo256oiqls	77	Coeur d'Aloes	https://res.cloudinary.com/dwgrotjh0/image/upload/v1772129807/appfbo/products/77.png	22000	0.100	1.000	t	2026-02-26 18:12:22.487	2026-03-09 12:06:01.66	BUVABLE	La nouvelle formule de l'Aloe Pêche associe de l'Aloe vera (84,5%), de la purée de pêche et du jus concentré de raisin blanc pour une saveur douce et savoureuse, ainsi qu'une dose synergique de vitamine C. Le packaging, quant à lui, est 100% recyclable. Retrouvez la toute nouvelle version de l'Aloe Pêche pour une pause saine et gourmande !	88	country_ci_default
cmls41vj0000o6gu5hlxu9pyq	284	Aloe Avocado Face & Body Soap	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528130/appfbo/products/284.png	6500	0.027	0.100	t	2026-02-18 14:11:38.075	2026-03-11 13:02:27.96	SOINS_PERSONNELS	Enrichi en ingrédients naturels comme l’huile d’avocat pur et l’Aloe vera, le savon Visage et Corps Aloe Avocado nettoie et hydrate la peau en la laissant plus lisse, plus douce et plus éclatante.	48	country_ci_default
cmls4fhxp00176gu5u13bgf1m	48	Absorbent-C	https://res.cloudinary.com/dwgrotjh0/image/upload/v1771528079/appfbo/products/48.png	15000	0.069	0.100	t	2026-02-18 14:22:13.644	2026-03-11 13:02:28.051	NUTRITION	La vitamine C contribue à réduire la fatigue et permet de retrouver tonus et énergie. Elle est indispensable pour renforcer la résistance de l’organisme.	87	country_ci_default
\.


--
-- Data for Name: StockMovement; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public."StockMovement" (id, "productId", "preorderId", type, reason, qty, note, meta, "createdById", "createdAt") FROM stdin;
cmmewj6fm001c10p8879mhu2m	cmls3i2ka000c6gu5r0tuvg0x	cmmewbw5e000310p8xl7c5h0j	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls3i2ka000c6gu5r0tuvg0x", "preorderId": "cmmewbw5e000310p8xl7c5h0j"}	cmmc6gfhs00014nxc479niy5h	2026-03-06 12:59:50.483
cmmewj6fz001e10p8jii0fq2j	cmls41vj0000o6gu5hlxu9pyq	cmmewbw5e000310p8xl7c5h0j	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls41vj0000o6gu5hlxu9pyq", "preorderId": "cmmewbw5e000310p8xl7c5h0j"}	cmmc6gfhs00014nxc479niy5h	2026-03-06 12:59:50.496
cmmewj6g6001g10p8mjmbwzhb	cmls4fhxp00176gu5u13bgf1m	cmmewbw5e000310p8xl7c5h0j	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls4fhxp00176gu5u13bgf1m", "preorderId": "cmmewbw5e000310p8xl7c5h0j"}	cmmc6gfhs00014nxc479niy5h	2026-03-06 12:59:50.502
cmmeywivq003xco9dr0w6o5xs	cmls4fhxp00176gu5u13bgf1m	cmmeytpkk002wco9dongbaxj8	DEBIT	PREPARE_ORDER	10	Sortie de stock lors de la préparation commande	{"qty": 10, "productId": "cmls4fhxp00176gu5u13bgf1m", "preorderId": "cmmeytpkk002wco9dongbaxj8"}	cmmc6gfhs00014nxc479niy5h	2026-03-06 14:06:12.374
cmmi1l5hk001o3na6ar89mpu2	cmls38zg300046gu59fpffhug	cmmi1dg2x00063na6mjc3tcju	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls38zg300046gu59fpffhug", "preorderId": "cmmi1dg2x00063na6mjc3tcju"}	cmmc6gfhs00014nxc479niy5h	2026-03-08 17:44:39.177
cmmi1l5ia001q3na6unz1roam	cmlskghjo0001xe143p8q80fd	cmmi1dg2x00063na6mjc3tcju	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmlskghjo0001xe143p8q80fd", "preorderId": "cmmi1dg2x00063na6mjc3tcju"}	cmmc6gfhs00014nxc479niy5h	2026-03-08 17:44:39.202
cmmi1l5if001s3na6e6lj307n	cmm4fmlxz000113nm2tqerc8d	cmmi1dg2x00063na6mjc3tcju	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmm4fmlxz000113nm2tqerc8d", "preorderId": "cmmi1dg2x00063na6mjc3tcju"}	cmmc6gfhs00014nxc479niy5h	2026-03-08 17:44:39.207
cmmj3b37x0002fngvq3y0iv3h	cmls3x9x5000m6gu5k6l06mvb	cmmj0cmng0003147a0uuk27cz	DEBIT	PREPARE_ORDER	2	Sortie de stock lors de la préparation commande	{"qty": 2, "productId": "cmls3x9x5000m6gu5k6l06mvb", "preorderId": "cmmj0cmng0003147a0uuk27cz"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 11:20:35.086
cmmj3b38o0004fngv9zmolxs6	cmm2aajt70000ie0ay4rcf48m	cmmj0cmng0003147a0uuk27cz	DEBIT	PREPARE_ORDER	2	Sortie de stock lors de la préparation commande	{"qty": 2, "productId": "cmm2aajt70000ie0ay4rcf48m", "preorderId": "cmmj0cmng0003147a0uuk27cz"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 11:20:35.113
cmmj3b38w0006fngv9aff5j16	cmls4fhxp00176gu5u13bgf1m	cmmj0cmng0003147a0uuk27cz	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls4fhxp00176gu5u13bgf1m", "preorderId": "cmmj0cmng0003147a0uuk27cz"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 11:20:35.12
cmmj3b3990008fngvt2f9nvbb	cmls41vj0000o6gu5hlxu9pyq	cmmj0cmng0003147a0uuk27cz	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls41vj0000o6gu5hlxu9pyq", "preorderId": "cmmj0cmng0003147a0uuk27cz"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 11:20:35.133
cmmj4xj1v001a10c222xnm9x8	cmls3r44r000d6gu58mrzo3rg	cmmj4dnuz000310c22dko6wk9	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls3r44r000d6gu58mrzo3rg", "preorderId": "cmmj4dnuz000310c22dko6wk9"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 12:06:01.651
cmmj4xj20001c10c2n5snup40	cmls4ot9e00196gu5susrhq13	cmmj4dnuz000310c22dko6wk9	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls4ot9e00196gu5susrhq13", "preorderId": "cmmj4dnuz000310c22dko6wk9"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 12:06:01.657
cmmj4xj25001e10c21e8bgw1x	cmm3s6a9300002efo256oiqls	cmmj4dnuz000310c22dko6wk9	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmm3s6a9300002efo256oiqls", "preorderId": "cmmj4dnuz000310c22dko6wk9"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 12:06:01.662
cmmjbll9i001fxm3tqtn80qg6	cmls3i2ka000c6gu5r0tuvg0x	cmmjb494e0003xm3tbt47lghg	DEBIT	PREPARE_ORDER	3	Sortie de stock lors de la préparation commande	{"qty": 3, "productId": "cmls3i2ka000c6gu5r0tuvg0x", "preorderId": "cmmjb494e0003xm3tbt47lghg"}	cmmc6gfhs00014nxc479niy5h	2026-03-09 15:12:41.958
cmmm1tt9r002khxjgl122nn86	cmls3i2ka000c6gu5r0tuvg0x	cmmm1k0830014hxjg53foxruc	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls3i2ka000c6gu5r0tuvg0x", "preorderId": "cmmm1k0830014hxjg53foxruc"}	cmmc6gfhs00014nxc479niy5h	2026-03-11 13:02:27.951
cmmm1ttav002mhxjghneax6xz	cmls41vj0000o6gu5hlxu9pyq	cmmm1k0830014hxjg53foxruc	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls41vj0000o6gu5hlxu9pyq", "preorderId": "cmmm1k0830014hxjg53foxruc"}	cmmc6gfhs00014nxc479niy5h	2026-03-11 13:02:27.991
cmmm1ttcm002ohxjg38pwi7cr	cmls4fhxp00176gu5u13bgf1m	cmmm1k0830014hxjg53foxruc	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls4fhxp00176gu5u13bgf1m", "preorderId": "cmmm1k0830014hxjg53foxruc"}	cmmc6gfhs00014nxc479niy5h	2026-03-11 13:02:28.055
cmmm1ttcu002qhxjgyhg2bsjg	cmls4ot9e00196gu5susrhq13	cmmm1k0830014hxjg53foxruc	DEBIT	PREPARE_ORDER	1	Sortie de stock lors de la préparation commande	{"qty": 1, "productId": "cmls4ot9e00196gu5susrhq13", "preorderId": "cmmm1k0830014hxjg53foxruc"}	cmmc6gfhs00014nxc479niy5h	2026-03-11 13:02:28.062
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: appfbo_db_user
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
ca2292c2-e73e-49a7-b9ab-55dd43c181a8	67a4670a96a913c7eaabb087d9f96f2c244c05f2e28cb992247fa5f6af08b72e	2026-03-06 11:25:54.948186+00	20260213003354_init_precommande	\N	\N	2026-03-06 11:25:53.599654+00	1
9b3676c1-67d2-4ec1-892f-38a93cb7b6e7	fba27d42b171317659041275cf349a969ffded922c65c7992b505aa839feb644	2026-03-06 11:25:56.812576+00	20260214182412_forever_grade_and_monney	\N	\N	2026-03-06 11:25:55.452304+00	1
ff59b5bd-5f2b-4363-ae1b-5d5e0c845467	da0894e395bd9221c9ed213617dce27c11c18b35aeb36276bdbe6b6a6fefb947	2026-03-06 11:25:59.091944+00	20260225180903_add_product_category_details_stock	\N	\N	2026-03-06 11:25:57.453983+00	1
ed4a12bf-29d4-43f9-8223-5d5f1af29542	36ad844db31e784f4534b541879f283096c4a0da3eff1750ccdd49abfd37f41a	2026-03-06 11:26:01.100027+00	20260227132822_rename_roche_to_ruche	\N	\N	2026-03-06 11:25:59.653266+00	1
5b33c94b-1b58-4bea-aacf-a519f1df8df1	b5062e89ee375537b069992aee4642ca16d12808307d71c63edf26c865426a80	2026-03-06 11:26:03.085604+00	20260227134410_add_ruche_keep_roche	\N	\N	2026-03-06 11:26:01.605762+00	1
58063d2c-9d74-480a-bc4b-d9cd81437501	b4d89c52f041536b1b87e9490e667696814e9deb23127a2bf8735d46818bb9e6	2026-03-06 11:26:05.030971+00	20260228230542_drop_roche_from_enum	\N	\N	2026-03-06 11:26:03.592251+00	1
4257bf67-32ba-45f9-b427-c9e5dceb6c57	e7c530e9f1e32e73b3deb27275298d143fdca080bbedfb3c6aff3c1ab0861b72	2026-03-06 11:26:06.871667+00	20260302131611_preorder_workflow_admin	\N	\N	2026-03-06 11:26:05.553316+00	1
c8843d9f-d58c-4674-bf0b-27bf7e1d4001	b6a70ff4c3985a68f9ed81c5c6da2111e89aaaec70f4b196ed3251f0fa95ceb8	2026-03-06 11:26:08.831069+00	20260303103000_country_context	\N	\N	2026-03-06 11:26:07.392818+00	1
d4f42036-8edd-4da6-ab3d-53f38123c691	124dd3b245bd9a764c4e5e0a683a7aa1a8a52848ff22f34833e22f2d9ebddd8c	2026-03-06 11:26:10.765614+00	20260303170000_admin_rbac_country_mobility	\N	\N	2026-03-06 11:26:09.342485+00	1
10b82c6c-c7c0-4b16-b82d-c7cca0e9a1c3	d1a2e81563832a704875eb564025cb19605f9fc54ae6ede2b9efbf459d3e90f3	2026-03-06 11:26:40.780461+00	20260306112638_add_stock_movements_and_preorder_workflow_fields	\N	\N	2026-03-06 11:26:39.386353+00	1
4ad80ca8-a4f0-45ae-af17-5c8f052a9fd4	67a4670a96a913c7eaabb087d9f96f2c244c05f2e28cb992247fa5f6af08b72e	2026-02-18 06:03:22.253086+00	20260213003354_init_precommande	\N	\N	2026-02-18 06:03:22.009535+00	1
77c035e5-0577-4a3f-aa94-c152cd945c66	e7c530e9f1e32e73b3deb27275298d143fdca080bbedfb3c6aff3c1ab0861b72	2026-03-02 13:27:03.451373+00	20260302131611_preorder_workflow_admin	\N	\N	2026-03-02 13:27:03.357209+00	1
21dda151-215a-4c51-bcb4-d3201e84cb59	fba27d42b171317659041275cf349a969ffded922c65c7992b505aa839feb644	2026-02-18 06:03:22.377235+00	20260214182412_forever_grade_and_monney	\N	\N	2026-02-18 06:03:22.256864+00	1
88bf1056-6ea4-41fe-87e1-57c1feb62ecd	da0894e395bd9221c9ed213617dce27c11c18b35aeb36276bdbe6b6a6fefb947	2026-02-26 12:43:32.395631+00	20260225180903_add_product_category_details_stock	\N	\N	2026-02-26 12:43:32.364521+00	1
0c33df7f-7f8e-4041-92bc-e4c502a4059c	b4d89c52f041536b1b87e9490e667696814e9deb23127a2bf8735d46818bb9e6	\N	20260227132822_rename_roche_to_ruche	\N	2026-02-28 19:53:41.853988+00	2026-02-27 13:32:01.051016+00	0
e57ce4af-e48a-49b9-ab1a-1d470786853e	b4d89c52f041536b1b87e9490e667696814e9deb23127a2bf8735d46818bb9e6	\N	20260227132822_rename_roche_to_ruche	\N	2026-02-28 20:36:40.250885+00	2026-02-28 20:04:03.378047+00	0
84aa4fe5-60f6-4d8d-9856-a22b984c98fd	124dd3b245bd9a764c4e5e0a683a7aa1a8a52848ff22f34833e22f2d9ebddd8c	2026-03-04 12:19:11.558288+00	20260303170000_admin_rbac_country_mobility	\N	\N	2026-03-04 12:19:10.061223+00	1
0577c048-5cfb-4714-929f-c542c13206b9	36ad844db31e784f4534b541879f283096c4a0da3eff1750ccdd49abfd37f41a	2026-02-28 20:48:27.255109+00	20260227132822_rename_roche_to_ruche	\N	\N	2026-02-28 20:48:27.167654+00	1
d264b398-50f7-4943-8cae-a0fc09bee925	0e6acdcac8e96ed1fb868633efb2f468f452fe8ae84d6e6ba6ccf020ee46d79b	\N	20260303103000_country_context	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260303103000_country_context\n\nDatabase error code: 42P10\n\nDatabase error:\nERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P10), message: "there is no unique or exclusion constraint matching the ON CONFLICT specification", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("plancat.c"), line: Some(958), routine: Some("infer_arbiter_indexes") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260303103000_country_context"\n             at schema-engine\\connectors\\sql-schema-connector\\src\\apply_migration.rs:106\n   1: schema_core::commands::apply_migrations::Applying migration\n           with migration_name="20260303103000_country_context"\n             at schema-engine\\core\\src\\commands\\apply_migrations.rs:91\n   2: schema_core::state::ApplyMigrations\n             at schema-engine\\core\\src\\state.rs:226	2026-03-04 12:18:37.201201+00	2026-03-03 13:09:41.307961+00	0
062c2b82-1b7c-4729-9a52-45e2ca8de8dd	d0c23191ba49811edb6705931775e17849cb379a3c209f5cf06c105ff825ef26	\N	20260227134410_add_ruche_keep_roche	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260227134410_add_ruche_keep_roche\n\nDatabase error code: 42710\n\nDatabase error:\nERROR: enum label "PRODUIT_DE_LA_ROCHE" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42710), message: "enum label \\"PRODUIT_DE_LA_ROCHE\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("pg_enum.c"), line: Some(348), routine: Some("AddEnumLabel") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260227134410_add_ruche_keep_roche"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:106\n   1: schema_core::commands::apply_migrations::Applying migration\n           with migration_name="20260227134410_add_ruche_keep_roche"\n             at schema-engine/core/src/commands/apply_migrations.rs:91\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:226	2026-02-28 21:13:52.381876+00	2026-02-28 20:48:27.258509+00	0
1c94f602-de10-43cd-b315-1ef37fa80941	b5062e89ee375537b069992aee4642ca16d12808307d71c63edf26c865426a80	2026-02-28 21:18:09.675743+00	20260227134410_add_ruche_keep_roche	\N	\N	2026-02-28 21:18:09.665747+00	1
561a0740-562e-4ada-bfa3-c423151e313a	b4d89c52f041536b1b87e9490e667696814e9deb23127a2bf8735d46818bb9e6	2026-02-28 23:11:19.659299+00	20260228230542_drop_roche_from_enum	\N	\N	2026-02-28 23:11:19.454146+00	1
994c67f4-b2cc-40dd-9126-45b3a6c6226f	b6a70ff4c3985a68f9ed81c5c6da2111e89aaaec70f4b196ed3251f0fa95ceb8	2026-03-04 12:19:09.542795+00	20260303103000_country_context	\N	\N	2026-03-04 12:19:08.159992+00	1
\.


--
-- Name: AdminUser AdminUser_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."AdminUser"
    ADD CONSTRAINT "AdminUser_pkey" PRIMARY KEY (id);


--
-- Name: CountrySettings CountrySettings_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."CountrySettings"
    ADD CONSTRAINT "CountrySettings_pkey" PRIMARY KEY (id);


--
-- Name: Country Country_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Country"
    ADD CONSTRAINT "Country_pkey" PRIMARY KEY (id);


--
-- Name: FboCountry FboCountry_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."FboCountry"
    ADD CONSTRAINT "FboCountry_pkey" PRIMARY KEY (id);


--
-- Name: Fbo Fbo_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Fbo"
    ADD CONSTRAINT "Fbo_pkey" PRIMARY KEY (id);


--
-- Name: GradeDiscount GradeDiscount_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."GradeDiscount"
    ADD CONSTRAINT "GradeDiscount_pkey" PRIMARY KEY (id);


--
-- Name: OrderMessageEvent OrderMessageEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."OrderMessageEvent"
    ADD CONSTRAINT "OrderMessageEvent_pkey" PRIMARY KEY (id);


--
-- Name: OrderMessage OrderMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."OrderMessage"
    ADD CONSTRAINT "OrderMessage_pkey" PRIMARY KEY (id);


--
-- Name: PreorderItem PreorderItem_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."PreorderItem"
    ADD CONSTRAINT "PreorderItem_pkey" PRIMARY KEY (id);


--
-- Name: PreorderLog PreorderLog_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."PreorderLog"
    ADD CONSTRAINT "PreorderLog_pkey" PRIMARY KEY (id);


--
-- Name: Preorder Preorder_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_pkey" PRIMARY KEY (id);


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: StockMovement StockMovement_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AdminUser_countryId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "AdminUser_countryId_idx" ON public."AdminUser" USING btree ("countryId");


--
-- Name: AdminUser_email_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "AdminUser_email_key" ON public."AdminUser" USING btree (email);


--
-- Name: AdminUser_role_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "AdminUser_role_idx" ON public."AdminUser" USING btree (role);


--
-- Name: CountrySettings_countryId_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "CountrySettings_countryId_key" ON public."CountrySettings" USING btree ("countryId");


--
-- Name: Country_code_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "Country_code_key" ON public."Country" USING btree (code);


--
-- Name: FboCountry_countryId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "FboCountry_countryId_idx" ON public."FboCountry" USING btree ("countryId");


--
-- Name: FboCountry_fboId_countryId_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "FboCountry_fboId_countryId_key" ON public."FboCountry" USING btree ("fboId", "countryId");


--
-- Name: Fbo_grade_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Fbo_grade_idx" ON public."Fbo" USING btree (grade);


--
-- Name: Fbo_numeroFbo_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "Fbo_numeroFbo_key" ON public."Fbo" USING btree ("numeroFbo");


--
-- Name: Fbo_pointDeVente_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Fbo_pointDeVente_idx" ON public."Fbo" USING btree ("pointDeVente");


--
-- Name: GradeDiscount_countryId_grade_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "GradeDiscount_countryId_grade_key" ON public."GradeDiscount" USING btree ("countryId", grade);


--
-- Name: GradeDiscount_countryId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "GradeDiscount_countryId_idx" ON public."GradeDiscount" USING btree ("countryId");


--
-- Name: OrderMessageEvent_orderMessageId_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "OrderMessageEvent_orderMessageId_createdAt_idx" ON public."OrderMessageEvent" USING btree ("orderMessageId", "createdAt");


--
-- Name: OrderMessage_preorderId_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "OrderMessage_preorderId_createdAt_idx" ON public."OrderMessage" USING btree ("preorderId", "createdAt");


--
-- Name: OrderMessage_providerMessageId_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "OrderMessage_providerMessageId_key" ON public."OrderMessage" USING btree ("providerMessageId");


--
-- Name: OrderMessage_provider_providerMessageId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "OrderMessage_provider_providerMessageId_idx" ON public."OrderMessage" USING btree (provider, "providerMessageId");


--
-- Name: OrderMessage_status_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "OrderMessage_status_idx" ON public."OrderMessage" USING btree (status);


--
-- Name: PreorderItem_preorderId_productId_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "PreorderItem_preorderId_productId_key" ON public."PreorderItem" USING btree ("preorderId", "productId");


--
-- Name: PreorderItem_productId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "PreorderItem_productId_idx" ON public."PreorderItem" USING btree ("productId");


--
-- Name: PreorderLog_preorderId_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "PreorderLog_preorderId_createdAt_idx" ON public."PreorderLog" USING btree ("preorderId", "createdAt");


--
-- Name: Preorder_cancelledById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_cancelledById_idx" ON public."Preorder" USING btree ("cancelledById");


--
-- Name: Preorder_countryId_status_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_countryId_status_createdAt_idx" ON public."Preorder" USING btree ("countryId", status, "createdAt");


--
-- Name: Preorder_factureReference_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_factureReference_idx" ON public."Preorder" USING btree ("factureReference");


--
-- Name: Preorder_fboId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_fboId_idx" ON public."Preorder" USING btree ("fboId");


--
-- Name: Preorder_fulfilledById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_fulfilledById_idx" ON public."Preorder" USING btree ("fulfilledById");


--
-- Name: Preorder_invoicedById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_invoicedById_idx" ON public."Preorder" USING btree ("invoicedById");


--
-- Name: Preorder_paymentVerifiedById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_paymentVerifiedById_idx" ON public."Preorder" USING btree ("paymentVerifiedById");


--
-- Name: Preorder_pointDeVente_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_pointDeVente_idx" ON public."Preorder" USING btree ("pointDeVente");


--
-- Name: Preorder_preparedById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_preparedById_idx" ON public."Preorder" USING btree ("preparedById");


--
-- Name: Preorder_proofReceivedById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_proofReceivedById_idx" ON public."Preorder" USING btree ("proofReceivedById");


--
-- Name: Preorder_status_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Preorder_status_createdAt_idx" ON public."Preorder" USING btree (status, "createdAt");


--
-- Name: Product_actif_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Product_actif_idx" ON public."Product" USING btree (actif);


--
-- Name: Product_category_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Product_category_idx" ON public."Product" USING btree (category);


--
-- Name: Product_countryId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Product_countryId_idx" ON public."Product" USING btree ("countryId");


--
-- Name: Product_nom_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "Product_nom_idx" ON public."Product" USING btree (nom);


--
-- Name: Product_sku_key; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE UNIQUE INDEX "Product_sku_key" ON public."Product" USING btree (sku);


--
-- Name: StockMovement_createdById_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "StockMovement_createdById_idx" ON public."StockMovement" USING btree ("createdById");


--
-- Name: StockMovement_preorderId_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "StockMovement_preorderId_idx" ON public."StockMovement" USING btree ("preorderId");


--
-- Name: StockMovement_productId_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "StockMovement_productId_createdAt_idx" ON public."StockMovement" USING btree ("productId", "createdAt");


--
-- Name: StockMovement_reason_createdAt_idx; Type: INDEX; Schema: public; Owner: appfbo_db_user
--

CREATE INDEX "StockMovement_reason_createdAt_idx" ON public."StockMovement" USING btree (reason, "createdAt");


--
-- Name: AdminUser AdminUser_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."AdminUser"
    ADD CONSTRAINT "AdminUser_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CountrySettings CountrySettings_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."CountrySettings"
    ADD CONSTRAINT "CountrySettings_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FboCountry FboCountry_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."FboCountry"
    ADD CONSTRAINT "FboCountry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FboCountry FboCountry_fboId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."FboCountry"
    ADD CONSTRAINT "FboCountry_fboId_fkey" FOREIGN KEY ("fboId") REFERENCES public."Fbo"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: GradeDiscount GradeDiscount_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."GradeDiscount"
    ADD CONSTRAINT "GradeDiscount_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OrderMessageEvent OrderMessageEvent_orderMessageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."OrderMessageEvent"
    ADD CONSTRAINT "OrderMessageEvent_orderMessageId_fkey" FOREIGN KEY ("orderMessageId") REFERENCES public."OrderMessage"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OrderMessage OrderMessage_preorderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."OrderMessage"
    ADD CONSTRAINT "OrderMessage_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES public."Preorder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PreorderItem PreorderItem_preorderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."PreorderItem"
    ADD CONSTRAINT "PreorderItem_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES public."Preorder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PreorderItem PreorderItem_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."PreorderItem"
    ADD CONSTRAINT "PreorderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PreorderLog PreorderLog_preorderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."PreorderLog"
    ADD CONSTRAINT "PreorderLog_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES public."Preorder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Preorder Preorder_cancelledById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Preorder Preorder_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Preorder Preorder_fboId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_fboId_fkey" FOREIGN KEY ("fboId") REFERENCES public."Fbo"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Preorder Preorder_fulfilledById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Preorder Preorder_invoicedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_invoicedById_fkey" FOREIGN KEY ("invoicedById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Preorder Preorder_paymentVerifiedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_paymentVerifiedById_fkey" FOREIGN KEY ("paymentVerifiedById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Preorder Preorder_preparedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Preorder Preorder_proofReceivedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Preorder"
    ADD CONSTRAINT "Preorder_proofReceivedById_fkey" FOREIGN KEY ("proofReceivedById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_countryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES public."Country"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: StockMovement StockMovement_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StockMovement StockMovement_preorderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES public."Preorder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StockMovement StockMovement_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: appfbo_db_user
--

ALTER TABLE ONLY public."StockMovement"
    ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: appfbo_db_user
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON SEQUENCES TO appfbo_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TYPES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TYPES TO appfbo_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON FUNCTIONS TO appfbo_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TABLES TO appfbo_db_user;


--
-- PostgreSQL database dump complete
--

\unrestrict gJVzWlKWlf3ssovBcP5UIGtx5j7hY6Vy6vuEnwKUhhNa9WicAiUbPdbQ4pWJHoK

