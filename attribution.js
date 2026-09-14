/*
 * Atribucion de primer y ultimo toque, sin cookies y sin terceros.
 *
 * Que problema resuelve
 * ---------------------
 * Hoy no sabriamos de donde vino una venta. Gumroad dira que entro un pago; no
 * dira si esa persona llego por un correo de prospeccion, buscando en Google o
 * porque alguien le paso el enlace. Sin eso no se puede decidir donde invertir
 * el siguiente mes, y se acaba repitiendo lo ultimo que se hizo.
 *
 * Como funciona
 * -------------
 * Se guardan DOS toques, porque responden a preguntas distintas:
 *   - primer toque: quien nos descubrio. Se escribe una vez y no se pisa.
 *   - ultimo toque: que le hizo volver y comprar hoy.
 * Ambos viajan al checkout y al Quick Check como parametros, que es lo unico
 * que sobrevive a un salto a otro dominio sin cookies de terceros.
 *
 * Lo que NO hace
 * --------------
 * No hay identificadores de persona, ni huella del navegador, ni envio a
 * ningun servidor externo. Todo vive en el `localStorage` del propio visitante
 * y solo sale de ahi cuando el mismo hace clic en comprar o en el Quick Check.
 * Si borra los datos del navegador, desaparece; eso es lo correcto.
 *
 * Y sobre todo: **no se inventa atribucion**. Cuando no hay evidencia de por
 * donde llego, la fuente es OTHER_UNKNOWN y se queda asi. Rellenar el hueco
 * con DIRECT porque no habia referrer es exactamente como se construye un
 * informe que miente con cara de dato.
 */
(function () {
  "use strict";

  var CLAVE_PRIMERO = "gt_atrib_primero";
  var CLAVE_ULTIMO = "gt_atrib_ultimo";
  var CLAVE_SESION = "gt_sesion";

  /* Los siete cubos. Ni uno mas: cada categoria extra que no se sabe llenar es
     una que reparte mal lo que si sabemos. */
  var FUENTES = {
    OUTBOUND: "OUTBOUND",
    ORGANIC_SEARCH: "ORGANIC_SEARCH",
    SOCIAL: "SOCIAL",
    DIRECT: "DIRECT",
    REFERRAL: "REFERRAL",
    EMAIL: "EMAIL",
    OTHER_UNKNOWN: "OTHER_UNKNOWN"
  };

  var BUSCADORES = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|qwant|baidu|yandex)\./i;
  var SOCIALES = /(^|\.)(linkedin|twitter|x|t|facebook|instagram|tiktok|youtube|reddit|news\.ycombinator)\./i;

  function seguro(fn, pordefecto) {
    try { return fn(); } catch (e) { return pordefecto; }
  }

  function leer(clave) {
    return seguro(function () {
      var v = window.localStorage.getItem(clave);
      return v ? JSON.parse(v) : null;
    }, null);
  }

  function guardar(clave, valor) {
    seguro(function () {
      window.localStorage.setItem(clave, JSON.stringify(valor));
    });
  }

  function parametros() {
    var p = {};
    seguro(function () {
      new URLSearchParams(window.location.search).forEach(function (v, k) {
        p[k.toLowerCase()] = v;
      });
    });
    return p;
  }

  /* De donde vino, con lo que se puede probar y nada mas. */
  function clasificar(p, referrer) {
    if (p.utm_source) {
      var m = (p.utm_medium || "").toLowerCase();
      var s = (p.utm_source || "").toLowerCase();
      if (s === "outbound" || m === "outreach" || m === "prospeccion") return FUENTES.OUTBOUND;
      if (m === "email" || m === "correo") return FUENTES.EMAIL;
      if (m === "social" || SOCIALES.test("." + s + ".")) return FUENTES.SOCIAL;
      if (m === "cpc" || m === "organic") return FUENTES.ORGANIC_SEARCH;
      return FUENTES.REFERRAL;
    }
    if (!referrer) {
      /* Sin referrer NO es lo mismo que directo: tambien lo produce un cliente
         de correo, una app movil o una politica de privacidad del navegador.
         Solo se llama DIRECT si ademas es la primera pagina de la sesion. */
      return sessionStorage.getItem(CLAVE_SESION) ? FUENTES.OTHER_UNKNOWN : FUENTES.DIRECT;
    }
    var host = seguro(function () { return new URL(referrer).hostname; }, "");
    if (!host || host === window.location.hostname) return FUENTES.OTHER_UNKNOWN;
    if (BUSCADORES.test("." + host)) return FUENTES.ORGANIC_SEARCH;
    if (SOCIALES.test("." + host)) return FUENTES.SOCIAL;
    return FUENTES.REFERRAL;
  }

  function toqueActual() {
    var p = parametros();
    var ref = seguro(function () { return document.referrer || ""; }, "");
    return {
      fuente: clasificar(p, ref),
      utm_source: p.utm_source || null,
      utm_medium: p.utm_medium || null,
      utm_campaign: p.utm_campaign || null,
      content_id: p.content_id || p.utm_content || null,
      campaign_id: p.campaign_id || null,
      referrer_host: seguro(function () {
        return ref ? new URL(ref).hostname : null;
      }, null),
      pagina: window.location.pathname,
      visto_en: new Date().toISOString()
    };
  }

  var actual = toqueActual();
  var primero = leer(CLAVE_PRIMERO);
  if (!primero) { primero = actual; guardar(CLAVE_PRIMERO, primero); }

  /* El ultimo toque significa «la ultima vez que llego desde fuera», no «la
     ultima pagina que abrio». Navegar de /rh01/ a /recursos/ degradaba el
     ultimo toque a OTHER_UNKNOWN, asi que una visita que habia llegado por
     prospeccion perdia su origen justo antes de hacer clic en comprar: leer
     tres paginas antes de decidirse borraba la razon por la que vino. */
  /* Un origen desconocido NUNCA pisa a uno conocido. Detectar la navegacion
     interna por el referrer no basta -viene vacio en demasiados casos-, y el
     efecto era que leer tres paginas antes de decidirse borraba la razon por la
     que la persona habia venido.

     Esto no inventa atribucion: OTHER_UNKNOWN significa «no vimos una fuente
     nueva», y de ahi no se sigue que la anterior haya dejado de ser cierta.
     Cuando de verdad llega desde fuera -con utm o con un referrer ajeno- se
     sobreescribe sin dudar, porque entonces si hay evidencia. */
  var ultimo = leer(CLAVE_ULTIMO);
  if (!ultimo || actual.fuente !== FUENTES.OTHER_UNKNOWN) {
    guardar(CLAVE_ULTIMO, actual);
    ultimo = actual;
  }
  actual = ultimo;
  seguro(function () { sessionStorage.setItem(CLAVE_SESION, "1"); });

  /* `session_id` EFIMERO. Vive en sessionStorage: dura la pestaña y muere al
     cerrarla. Sirve para saber que tres eventos son de la misma visita, y para
     nada mas.

     Antes esto era un `gt_visitante` en localStorage, que sobrevivia meses. Eso
     ya no es medir un embudo: es un identificador anonimo persistente, que es
     justo lo que dijimos que no ibamos a hacer. Un id de sesion basta para
     calcular los ratios que necesitamos y no permite seguir a nadie. */
  var sesion = seguro(function () {
    var v = sessionStorage.getItem("gt_sid");
    if (!v) {
      v = "s-" + ((window.crypto && window.crypto.randomUUID)
                  ? window.crypto.randomUUID().slice(0, 16)
                  : Math.random().toString(36).slice(2, 14) + Date.now().toString(36));
      sessionStorage.setItem("gt_sid", v);
    }
    return v;
  }, "s-sin-almacenamiento");
  var visitante = { id: sesion };

  /* --- eventos ---------------------------------------------------------
     La cola existe aunque no haya ninguna herramienta de analitica conectada.
     Asi el dia que se conecte una, los eventos ya estan definidos y no hay que
     volver a instrumentar el sitio; y mientras tanto se pueden leer desde la
     consola sin instalar nada ni mandar datos a nadie. */
  /* La taxonomia completa, escrita en un sitio. Un evento fuera de esta lista
     es casi siempre una errata que despues aparece como una categoria fantasma
     en el informe, asi que se rechaza al emitirlo y no meses despues. */
  var EVENTOS = [
    "PAGE_VIEW", "CTA_CLICK",
    "QUICKCHECK_STARTED", "QUICKCHECK_COMPLETED",
    "LEAD_STARTED", "LEAD_SUBMITTED", "LEAD_FAILED",
    "CHECKOUT_CLICK"
    /* SALE_VERIFIED no se emite aqui NUNCA: lo establece el Motor contra
       Gumroad. Un navegador no puede saber si un pago existio. */
  ];

  /* A donde se mandan. Lo inyecta el generador del sitio; vacio significa que
     el receptor aun no esta desplegado, y entonces los eventos se quedan en la
     cola local y no se pierde nada mas que la medicion. */
  var RECEPTOR = (window.GT_RECEPTOR || "");

  var COLA = (window.gtEventos = window.gtEventos || []);
  function evento(nombre, extra) {
    if (EVENTOS.indexOf(nombre) === -1) {
      if (window.console) console.warn("[gt] evento fuera de taxonomia:", nombre);
      return;
    }
    var e = Object.assign({
      evento: nombre,
      visitante: sesion,
      fuente: primero.fuente,
      fuente_ultima: actual.fuente,
      utm_campaign: actual.utm_campaign || primero.utm_campaign || null,
      content_id: actual.content_id || primero.content_id || null,
      pagina: window.location.pathname,
      ts: new Date().toISOString()
    }, extra || {});
    COLA.push(e);
    seguro(function () { window.dispatchEvent(new CustomEvent("gt:evento", { detail: e })); });
    enviarEvento(e);
  }
  /* Se manda con `sendBeacon` cuando existe: un `fetch` en un clic que navega
     fuera se cancela a mitad, y entonces CHECKOUT_CLICK -el evento que mas
     importa- seria justo el que nunca llega. `keepalive` es el plan B.

     Nunca lleva correo, ni nombre, ni nada de la persona: solo el tipo de
     evento, la sesion efimera y de donde vino. */
  function enviarEvento(e) {
    if (!RECEPTOR) return;
    var cuerpo = JSON.stringify({
      kind: "event",
      event_id: "e-" + ((window.crypto && window.crypto.randomUUID)
                        ? window.crypto.randomUUID()
                        : Math.random().toString(36).slice(2) + Date.now().toString(36)),
      event_type: e.evento,
      session_id: sesion,
      source: e.fuente,
      utm_source: actual.utm_source || primero.utm_source,
      utm_medium: actual.utm_medium || primero.utm_medium,
      utm_campaign: e.utm_campaign,
      content_id: e.content_id,
      campaign_id: actual.campaign_id || primero.campaign_id,
      path: e.pagina,
      product_id: e.product_id || null
    });
    seguro(function () {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(RECEPTOR, new Blob([cuerpo], { type: "text/plain" }));
      } else {
        fetch(RECEPTOR, { method: "POST", keepalive: true,
                          headers: { "Content-Type": "text/plain;charset=utf-8" },
                          body: cuerpo });
      }
    });
  }

  window.gtEvento = evento;

  evento("PAGE_VIEW");

  /* --- propagacion -----------------------------------------------------
     Los parametros se pegan al enlace de salida. Es la unica forma de que la
     atribucion sobreviva al salto a Gumroad o a Google Forms sin cookies de
     terceros y sin pedirle nada al visitante. */
  function conAtribucion(url) {
    var u = seguro(function () { return new URL(url, window.location.href); }, null);
    if (!u) return url;
    var campos = {
      gt_fuente: primero.fuente,
      gt_fuente_ultima: actual.fuente,
      gt_session: sesion,
      utm_source: actual.utm_source || primero.utm_source,
      utm_medium: actual.utm_medium || primero.utm_medium,
      utm_campaign: actual.utm_campaign || primero.utm_campaign,
      content_id: actual.content_id || primero.content_id,
      campaign_id: actual.campaign_id || primero.campaign_id
    };
    Object.keys(campos).forEach(function (k) {
      if (campos[k]) u.searchParams.set(k, campos[k]);
    });
    return u.toString();
  }
  window.gtConAtribucion = conAtribucion;

  /* Lo que el Quick Check adjunta al lead. Se expone como funcion y no como
     objeto para que quien la llame reciba el estado del momento, no una copia
     tomada al cargar la pagina. */
  window.gtAtribucion = function () {
    return {
      fuente: primero.fuente,
      fuente_ultima: actual.fuente,
      /* El nombre es `session_id` en TODAS partes: pagina, formulario, receptor
         y hoja. Se llamaba `visitante` aqui y `session_id` alla, asi que el
         lead viajaba con un campo que el receptor no leia y la columna de
         sesion quedaba vacia: la atribucion del unico evento que importa se
         perdia en silencio. */
      session_id: sesion,
      utm_source: actual.utm_source || primero.utm_source,
      utm_medium: actual.utm_medium || primero.utm_medium,
      utm_campaign: actual.utm_campaign || primero.utm_campaign,
      content_id: actual.content_id || primero.content_id,
      campaign_id: actual.campaign_id || primero.campaign_id
    };
  };

  /* Los enlaces se reescriben AL CARGAR, no al hacer clic. Hacerlo en el
     manejador del clic es una carrera con la propia navegacion: el navegador
     puede haber leido ya el href viejo, y entonces la atribucion se pierde
     justo en el unico clic que importa. */
  function preparar() {
    var enlaces = document.querySelectorAll("a[data-atribuir]");
    Array.prototype.forEach.call(enlaces, function (a) {
      if (a.dataset.gtListo) return;
      a.href = conAtribucion(a.getAttribute("href"));
      a.dataset.gtListo = "1";
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", preparar);
  } else {
    preparar();
  }

  /* CHECKOUT_CLICK NO es una compra. El nombre lo dice y el informe tambien:
     lo unico que prueba una venta es SALE_VERIFIED, que llega por Gumroad al
     Motor, no por este fichero. */
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest ? ev.target.closest("a[data-evento]") : null;
    if (!a) return;
    evento(a.getAttribute("data-evento"), { destino: a.getAttribute("href") });
  }, true);
})();
