// The client side of an invoice in the client's own language. Freelancers and
// clients are often in different countries; reading the terms in your own language
// removes doubt before you pay. No translation API: the wording is shipped here,
// so it's free, instant and works offline. The freelancer's own words (job title,
// delivery note) get a "Translate" link instead.
import { useSyncExternalStore } from "react";

export type Lang = "en" | "fr" | "es" | "pt" | "de" | "zh";

export const LANGS: { code: Lang; name: string; locale: string }[] = [
  { code: "en", name: "English", locale: "en-GB" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "pt", name: "Português", locale: "pt-BR" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "zh", name: "中文", locale: "zh-CN" },
];

const STORE_KEY = "paypact:lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved as Lang;
  } catch {
    /* no storage: fall back to the browser language */
  }
  for (const pref of navigator.languages ?? [navigator.language]) {
    const code = pref.slice(0, 2).toLowerCase();
    if (LANGS.some((l) => l.code === code)) return code as Lang;
  }
  return "en";
}

let current: Lang = typeof navigator === "undefined" ? "en" : detect();
const listeners = new Set<() => void>();

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    /* the choice just won't be remembered */
  }
  document.documentElement.lang = lang;
  listeners.forEach((f) => f());
}

export function getLang(): Lang {
  return current;
}

/** Re-render when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
  );
}

export const locale = () => LANGS.find((l) => l.code === current)!.locale;

/** Translate an English string; {name} placeholders are filled from `vars`. */
export function t(text: string, vars: Record<string, string | number> = {}): string {
  const row = DICT[text];
  const i = ORDER.indexOf(current);
  const out = current === "en" || !row || i < 0 ? text : row[i] || text;
  return out.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Google Translate link for text written by a person (job title, notes). */
export const translateUrl = (text: string) =>
  `https://translate.google.com/?sl=auto&tl=${current === "zh" ? "zh-CN" : current}&text=${encodeURIComponent(text)}&op=translate`;

const ORDER: Lang[] = ["fr", "es", "pt", "de", "zh"];

// English -> [French, Spanish, Portuguese, German, Chinese]. **text** renders bold.
const DICT: Record<string, [string, string, string, string, string]> = {
  // page
  "Invoice not found": ["Facture introuvable", "Factura no encontrada", "Fatura não encontrada", "Rechnung nicht gefunden", "找不到发票"],
  "Check the link and try again.": ["Vérifiez le lien et réessayez.", "Revisa el enlace e inténtalo de nuevo.", "Verifique o link e tente novamente.", "Prüfe den Link und versuche es erneut.", "请检查链接后重试。"],
  "Paid this invoice on another device? Open the private link you saved when you paid.": [
    "Vous avez payé sur un autre appareil ? Ouvrez le lien privé que vous avez enregistré lors du paiement.",
    "¿Pagaste en otro dispositivo? Abre el enlace privado que guardaste al pagar.",
    "Pagou em outro dispositivo? Abra o link privado que você salvou ao pagar.",
    "Auf einem anderen Gerät bezahlt? Öffne den privaten Link, den du beim Bezahlen gespeichert hast.",
    "在其他设备上付过款？请打开付款时保存的私人链接。",
  ],
  "Are you the freelancer?": ["Vous êtes le freelance ?", "¿Eres el freelancer?", "Você é o freelancer?", "Bist du der Freelancer?", "您是自由职业者吗？"],
  "Sign in": ["Se connecter", "Iniciar sesión", "Entrar", "Anmelden", "登录"],
  "Language": ["Langue", "Idioma", "Idioma", "Sprache", "语言"],
  "Translate": ["Traduire", "Traducir", "Traduzir", "Übersetzen", "翻译"],

  // summary
  "Invoice #{id}": ["Facture n° {id}", "Factura n.º {id}", "Fatura nº {id}", "Rechnung Nr. {id}", "发票 #{id}"],
  "From": ["De", "De", "De", "Von", "来自"],
  "due {date}": ["à rendre le {date}", "entrega el {date}", "entrega em {date}", "fällig am {date}", "截止 {date}"],
  "1 job completed": ["1 mission terminée", "1 trabajo completado", "1 trabalho concluído", "1 Auftrag abgeschlossen", "已完成 1 单"],
  "{n} jobs completed": ["{n} missions terminées", "{n} trabajos completados", "{n} trabalhos concluídos", "{n} Aufträge abgeschlossen", "已完成 {n} 单"],
  "{pct}% on time": ["{pct} % dans les délais", "{pct}% a tiempo", "{pct}% no prazo", "{pct} % pünktlich", "{pct}% 按时交付"],
  "🧾 Receipt (PDF)": ["🧾 Reçu (PDF)", "🧾 Recibo (PDF)", "🧾 Recibo (PDF)", "🧾 Beleg (PDF)", "🧾 收据（PDF）"],
  "New on PayPact": ["Nouveau sur PayPact", "Nuevo en PayPact", "Novo no PayPact", "Neu bei PayPact", "PayPact 新用户"],

  // statuses and progress
  "Waiting for payment": ["En attente de paiement", "Esperando el pago", "Aguardando pagamento", "Wartet auf Zahlung", "等待付款"],
  "🔒 Paid & locked": ["🔒 Payé et bloqué", "🔒 Pagado y bloqueado", "🔒 Pago e bloqueado", "🔒 Bezahlt & gesichert", "🔒 已付款并锁定"],
  "📦 Delivered, in review": ["📦 Livré, en vérification", "📦 Entregado, en revisión", "📦 Entregue, em análise", "📦 Geliefert, in Prüfung", "📦 已交付，审核中"],
  "⚠️ Problem reported": ["⚠️ Problème signalé", "⚠️ Problema reportado", "⚠️ Problema relatado", "⚠️ Problem gemeldet", "⚠️ 已报告问题"],
  "✅ Paid out": ["✅ Versé", "✅ Pagado", "✅ Pago", "✅ Ausgezahlt", "✅ 已放款"],
  "↩️ Refunded": ["↩️ Remboursé", "↩️ Reembolsado", "↩️ Reembolsado", "↩️ Erstattet", "↩️ 已退款"],
  "⚖️ Settled": ["⚖️ Réglé", "⚖️ Resuelto", "⚖️ Resolvido", "⚖️ Geregelt", "⚖️ 已和解"],
  "Cancelled": ["Annulée", "Cancelada", "Cancelada", "Storniert", "已取消"],
  "Invoice sent": ["Facture envoyée", "Factura enviada", "Fatura enviada", "Rechnung gesendet", "已发送发票"],
  "Paid & locked": ["Payé et bloqué", "Pagado y bloqueado", "Pago e bloqueado", "Bezahlt & gesichert", "已付款并锁定"],
  "Work delivered": ["Travail livré", "Trabajo entregado", "Trabalho entregue", "Arbeit geliefert", "工作已交付"],
  "Refunded": ["Remboursé", "Reembolsado", "Reembolsado", "Erstattet", "已退款"],
  "Paid out": ["Versé", "Pagado", "Pago", "Ausgezahlt", "已放款"],
  "{amount} sent up front": ["{amount} versés d'avance", "{amount} enviados por adelantado", "{amount} pagos adiantado", "{amount} vorab gezahlt", "已预付 {amount}"],

  // up front vs held
  "**Direct payment:** the full {amount} goes straight to the freelancer, as agreed. It is not held in escrow.": [
    "**Paiement direct :** la totalité ({amount}) va directement au freelance, comme convenu. Rien n'est bloqué en séquestre.",
    "**Pago directo:** el total de {amount} va directamente al freelancer, como se acordó. No se retiene en garantía.",
    "**Pagamento direto:** o valor total de {amount} vai direto para o freelancer, como combinado. Não fica retido em garantia.",
    "**Direktzahlung:** die vollen {amount} gehen wie vereinbart direkt an den Freelancer. Nichts wird treuhänderisch gehalten.",
    "**直接付款：**全部 {amount} 按约定直接付给自由职业者，不进入托管。",
  ],
  "**Direct payment:** the full {amount} went straight to the freelancer, as agreed. It is not held in escrow.": [
    "**Paiement direct :** la totalité ({amount}) est allée directement au freelance, comme convenu. Rien n'est bloqué en séquestre.",
    "**Pago directo:** el total de {amount} fue directamente al freelancer, como se acordó. No se retiene en garantía.",
    "**Pagamento direto:** o valor total de {amount} foi direto para o freelancer, como combinado. Não fica retido em garantia.",
    "**Direktzahlung:** die vollen {amount} gingen wie vereinbart direkt an den Freelancer. Nichts wird treuhänderisch gehalten.",
    "**直接付款：**全部 {amount} 已按约定直接付给自由职业者，未进入托管。",
  ],
  "**{amount}** goes to the freelancer immediately": [
    "**{amount}** vont immédiatement au freelance", "**{amount}** van al freelancer de inmediato", "**{amount}** vão para o freelancer na hora",
    "**{amount}** gehen sofort an den Freelancer", "**{amount}** 立即付给自由职业者",
  ],
  "**{amount}** paid to the freelancer immediately": [
    "**{amount}** versés immédiatement au freelance", "**{amount}** pagados al freelancer de inmediato", "**{amount}** pagos ao freelancer na hora",
    "**{amount}** sofort an den Freelancer gezahlt", "**{amount}** 已立即付给自由职业者",
  ],
  "(agreed up front)": ["(acompte convenu)", "(anticipo acordado)", "(adiantamento combinado)", "(vereinbarte Anzahlung)", "（约定的预付款）"],
  "**{amount}** held safely until you approve the work": [
    "**{amount}** bloqués en sécurité jusqu'à ce que vous validiez le travail",
    "**{amount}** retenidos de forma segura hasta que apruebes el trabajo",
    "**{amount}** guardados com segurança até você aprovar o trabalho",
    "**{amount}** sicher verwahrt, bis du die Arbeit freigibst",
    "**{amount}** 安全托管，直到您确认工作",
  ],

  // proof of delivery
  "📦 Proof of delivery": ["📦 Preuve de livraison", "📦 Prueba de entrega", "📦 Comprovante de entrega", "📦 Liefernachweis", "📦 交付证明"],
  "On time": ["Dans les délais", "A tiempo", "No prazo", "Pünktlich", "按时"],
  "Late": ["En retard", "Con retraso", "Atrasado", "Verspätet", "逾期"],
  "Delivered {date}": ["Livré le {date}", "Entregado el {date}", "Entregue em {date}", "Geliefert am {date}", "交付于 {date}"],
  "View the delivered work ↗": ["Voir le travail livré ↗", "Ver el trabajo entregado ↗", "Ver o trabalho entregue ↗", "Gelieferte Arbeit ansehen ↗", "查看交付的工作 ↗"],
  "Recorded on NEAR at the moment of delivery. Nobody can change it afterwards, so a dispute is judged against it.": [
    "Enregistré sur NEAR au moment de la livraison. Personne ne peut le modifier ensuite : un litige est jugé sur cette base.",
    "Registrado en NEAR en el momento de la entrega. Nadie puede cambiarlo después, así que una disputa se juzga con esto.",
    "Registrado na NEAR no momento da entrega. Ninguém pode alterá-lo depois, então uma disputa é julgada com base nele.",
    "Im Moment der Lieferung auf NEAR festgehalten. Niemand kann es später ändern, daher wird ein Streit danach beurteilt.",
    "交付时已记录在 NEAR 上，之后任何人都无法更改，争议将以此为准。",
  ],

  // demo
  "▶ Demo · step {n} of 4": ["▶ Démo · étape {n} sur 4", "▶ Demo · paso {n} de 4", "▶ Demo · etapa {n} de 4", "▶ Demo · Schritt {n} von 4", "▶ 演示 · 第 {n} 步，共 4 步"],
  "testnet, no real money": ["testnet, pas d'argent réel", "testnet, sin dinero real", "testnet, sem dinheiro real", "Testnet, kein echtes Geld", "测试网，非真实资金"],
  "You're the client. Demo Designer sent you this invoice. Tap Pay below (it's free test money).": [
    "Vous êtes le client. Demo Designer vous a envoyé cette facture. Appuyez sur Payer ci-dessous (argent de test gratuit).",
    "Eres el cliente. Demo Designer te envió esta factura. Toca Pagar abajo (es dinero de prueba gratis).",
    "Você é o cliente. Demo Designer enviou esta fatura. Toque em Pagar abaixo (é dinheiro de teste grátis).",
    "Du bist der Kunde. Demo Designer hat dir diese Rechnung geschickt. Tippe unten auf Bezahlen (kostenloses Testgeld).",
    "您是客户。Demo Designer 向您发送了这张发票。点击下方的付款（免费测试资金）。",
  ],
  "Your money is locked. Now let Demo Designer deliver the work:": [
    "Votre argent est bloqué. Laissez maintenant Demo Designer livrer le travail :",
    "Tu dinero está bloqueado. Ahora deja que Demo Designer entregue el trabajo:",
    "Seu dinheiro está bloqueado. Agora deixe o Demo Designer entregar o trabalho:",
    "Dein Geld ist gesichert. Lass jetzt Demo Designer die Arbeit liefern:",
    "您的资金已锁定。现在让 Demo Designer 交付工作：",
  ],
  "The work is delivered, with proof recorded on-chain. Check it, then tap Approve & release below.": [
    "Le travail est livré, avec une preuve enregistrée sur la blockchain. Vérifiez-le, puis appuyez sur Valider et verser ci-dessous.",
    "El trabajo está entregado, con prueba registrada en la blockchain. Revísalo y toca Aprobar y liberar abajo.",
    "O trabalho foi entregue, com comprovante registrado na blockchain. Confira e toque em Aprovar e liberar abaixo.",
    "Die Arbeit ist geliefert, mit Nachweis auf der Blockchain. Prüfe sie und tippe unten auf Freigeben & auszahlen.",
    "工作已交付，证明已记录在链上。查看后点击下方的确认并放款。",
  ],
  "Paid out in seconds. Leave Demo Designer a rating below.": [
    "Versé en quelques secondes. Laissez une note à Demo Designer ci-dessous.",
    "Pagado en segundos. Deja una valoración a Demo Designer abajo.",
    "Pago em segundos. Deixe uma avaliação para o Demo Designer abaixo.",
    "In Sekunden ausgezahlt. Bewerte Demo Designer unten.",
    "几秒内放款完成。请在下方为 Demo Designer 评分。",
  ],
  "That's the whole flow! Now try it for real: create your own invoice.": [
    "C'est tout le parcours ! Essayez maintenant pour de vrai : créez votre propre facture.",
    "¡Ese es todo el proceso! Ahora pruébalo de verdad: crea tu propia factura.",
    "Esse é o fluxo completo! Agora experimente de verdade: crie sua própria fatura.",
    "Das ist der ganze Ablauf! Probier es jetzt richtig aus: erstelle deine eigene Rechnung.",
    "完整流程就是这样！现在来真的：创建您自己的发票。",
  ],
  "Demo Designer delivers the work": ["Demo Designer livre le travail", "Demo Designer entrega el trabajo", "Demo Designer entrega o trabalho", "Demo Designer liefert die Arbeit", "Demo Designer 交付工作"],
  "Demo Designer delivered the work": ["Demo Designer a livré le travail", "Demo Designer entregó el trabajo", "Demo Designer entregou o trabalho", "Demo Designer hat die Arbeit geliefert", "Demo Designer 已交付工作"],
  "Create my own invoice": ["Créer ma facture", "Crear mi propia factura", "Criar minha fatura", "Eigene Rechnung erstellen", "创建我的发票"],
  "See Demo Designer's profile": ["Voir le profil de Demo Designer", "Ver el perfil de Demo Designer", "Ver o perfil do Demo Designer", "Profil von Demo Designer ansehen", "查看 Demo Designer 的资料"],

  // paying
  "This is a **direct payment**: it goes straight to {name}, as you agreed.": [
    "C'est un **paiement direct** : il va directement à {name}, comme convenu.",
    "Es un **pago directo**: va directamente a {name}, como acordaron.",
    "Este é um **pagamento direto**: vai direto para {name}, como combinado.",
    "Dies ist eine **Direktzahlung**: sie geht wie vereinbart direkt an {name}.",
    "这是一笔**直接付款**：按约定直接付给 {name}。",
  ],
  "**{amount}** goes to the freelancer right away, as agreed.": [
    "**{amount}** vont au freelance tout de suite, comme convenu.",
    "**{amount}** van al freelancer de inmediato, como se acordó.",
    "**{amount}** vão para o freelancer na hora, como combinado.",
    "**{amount}** gehen wie vereinbart sofort an den Freelancer.",
    "**{amount}** 按约定立即付给自由职业者。",
  ],
  "**{amount} is held safely** by a smart contract. It's released only when you approve the work, and refunded to you if nothing is delivered by {date}. Not even PayPact can touch it.": [
    "**{amount} sont bloqués en sécurité** par un contrat intelligent. Ils ne sont versés que lorsque vous validez le travail, et vous sont remboursés si rien n'est livré avant le {date}. Même PayPact ne peut pas y toucher.",
    "**{amount} quedan retenidos de forma segura** por un contrato inteligente. Solo se liberan cuando apruebas el trabajo, y se te reembolsan si no se entrega nada antes del {date}. Ni siquiera PayPact puede tocarlos.",
    "**{amount} ficam guardados com segurança** por um contrato inteligente. Só são liberados quando você aprova o trabalho, e são reembolsados se nada for entregue até {date}. Nem o PayPact pode mexer neles.",
    "**{amount} werden sicher verwahrt** von einem Smart Contract. Sie werden erst ausgezahlt, wenn du die Arbeit freigibst, und dir erstattet, wenn bis {date} nichts geliefert wird. Nicht einmal PayPact kann darauf zugreifen.",
    "**{amount} 由智能合约安全托管。**只有在您确认工作后才会放款；如果到 {date} 仍未交付，将退还给您。连 PayPact 也无法动用。",
  ],
  "Pay this invoice": ["Payer cette facture", "Pagar esta factura", "Pagar esta fatura", "Diese Rechnung bezahlen", "支付此发票"],
  "Pay {amount} (test money)": ["Payer {amount} (argent de test)", "Pagar {amount} (dinero de prueba)", "Pagar {amount} (dinheiro de teste)", "{amount} bezahlen (Testgeld)", "支付 {amount}（测试资金）"],
  "Paid. The money is locked for the freelancer.": [
    "Payé. L'argent est bloqué pour le freelance.", "Pagado. El dinero está bloqueado para el freelancer.", "Pago. O dinheiro está bloqueado para o freelancer.",
    "Bezahlt. Das Geld ist für den Freelancer gesichert.", "已付款。资金已为自由职业者锁定。",
  ],
  "On mainnet, pay with any crypto": ["Sur le mainnet, payez avec n'importe quelle crypto", "En mainnet, paga con cualquier cripto", "Na mainnet, pague com qualquer cripto", "Im Mainnet mit jeder Krypto bezahlen", "在主网上可用任意加密货币支付"],
  "Live prices": ["Prix en direct", "Precios en vivo", "Preços ao vivo", "Live-Preise", "实时价格"],
  "{coin} on {chain}": ["{coin} sur {chain}", "{coin} en {chain}", "{coin} na {chain}", "{coin} auf {chain}", "{chain} 上的 {coin}"],
  "Real quotes from NEAR Intents, fees included.": ["Cotations réelles de NEAR Intents, frais inclus.", "Cotizaciones reales de NEAR Intents, comisiones incluidas.", "Cotações reais da NEAR Intents, taxas incluídas.", "Echte Kurse von NEAR Intents, inklusive Gebühren.", "来自 NEAR Intents 的真实报价，已含手续费。"],
  "Updated {time}.": ["Mis à jour à {time}.", "Actualizado a las {time}.", "Atualizado às {time}.", "Aktualisiert um {time}.", "更新于 {time}。"],
  "Any-crypto payment runs on mainnet only, so this testnet demo pays with free test dollars below.": [
    "Le paiement en n'importe quelle crypto ne fonctionne que sur le mainnet ; cette démo testnet paie donc avec des dollars de test gratuits ci-dessous.",
    "El pago con cualquier cripto solo funciona en mainnet, así que esta demo en testnet paga con dólares de prueba gratis abajo.",
    "O pagamento com qualquer cripto só funciona na mainnet, então esta demo na testnet paga com dólares de teste grátis abaixo.",
    "Zahlung mit jeder Krypto läuft nur im Mainnet, daher zahlt diese Testnet-Demo unten mit kostenlosen Testdollars.",
    "任意加密货币支付仅在主网可用，因此本测试网演示使用下方的免费测试美元支付。",
  ],
  "Send exactly": ["Envoyez exactement", "Envía exactamente", "Envie exatamente", "Sende genau", "请准确发送"],
  "on **{chain}**, to this address. It arrives in about {s} seconds.": [
    "sur **{chain}**, à cette adresse. Arrivée en environ {s} secondes.", "en **{chain}**, a esta dirección. Llega en unos {s} segundos.",
    "na **{chain}**, para este endereço. Chega em cerca de {s} segundos.", "auf **{chain}** an diese Adresse. Kommt in etwa {s} Sekunden an.",
    "通过 **{chain}** 发送到此地址，约 {s} 秒到账。",
  ],
  "✅ Received. Locking it for the freelancer…": ["✅ Reçu. Blocage pour le freelance…", "✅ Recibido. Bloqueándolo para el freelancer…", "✅ Recebido. Bloqueando para o freelancer…", "✅ Erhalten. Wird für den Freelancer gesichert…", "✅ 已收到，正在为自由职业者锁定…"],
  "⏳ Payment seen, converting…": ["⏳ Paiement détecté, conversion…", "⏳ Pago detectado, convirtiendo…", "⏳ Pagamento detectado, convertendo…", "⏳ Zahlung erkannt, wird umgetauscht…", "⏳ 已检测到付款，正在兑换…"],
  "↩️ Something went wrong; your payment is being refunded to your address.": [
    "↩️ Un problème est survenu ; votre paiement est remboursé à votre adresse.", "↩️ Algo salió mal; tu pago se está reembolsando a tu dirección.",
    "↩️ Algo deu errado; seu pagamento está sendo reembolsado para o seu endereço.", "↩️ Etwas ist schiefgelaufen; deine Zahlung wird an deine Adresse erstattet.",
    "↩️ 出现问题，您的付款正在退回到您的地址。",
  ],
  "⚠️ The amount sent was too small; it will be refunded.": ["⚠️ Le montant envoyé est insuffisant ; il sera remboursé.", "⚠️ El monto enviado fue insuficiente; se reembolsará.", "⚠️ O valor enviado foi insuficiente; será reembolsado.", "⚠️ Der gesendete Betrag war zu gering; er wird erstattet.", "⚠️ 发送金额不足，将被退回。"],
  "Waiting for your payment…": ["En attente de votre paiement…", "Esperando tu pago…", "Aguardando seu pagamento…", "Warte auf deine Zahlung…", "等待您的付款…"],
  "{coin} deposit address ({chain})": ["Adresse de dépôt {coin} ({chain})", "Dirección de depósito de {coin} ({chain})", "Endereço de depósito de {coin} ({chain})", "{coin}-Einzahlungsadresse ({chain})", "{coin} 充值地址（{chain}）"],
  "Memo (required)": ["Mémo (obligatoire)", "Memo (obligatorio)", "Memo (obrigatório)", "Memo (erforderlich)", "备注（必填）"],
  "This page updates by itself. Only send {coin} on {chain}; anything else can be lost.": [
    "Cette page se met à jour toute seule. N'envoyez que du {coin} sur {chain} ; tout le reste peut être perdu.",
    "Esta página se actualiza sola. Envía solo {coin} en {chain}; cualquier otra cosa puede perderse.",
    "Esta página se atualiza sozinha. Envie apenas {coin} na {chain}; qualquer outra coisa pode ser perdida.",
    "Diese Seite aktualisiert sich selbst. Sende nur {coin} auf {chain}; alles andere kann verloren gehen.",
    "本页面会自动更新。请仅通过 {chain} 发送 {coin}，其他资产可能丢失。",
  ],
  "Choose another coin": ["Choisir une autre crypto", "Elegir otra moneda", "Escolher outra moeda", "Andere Kryptowährung wählen", "选择其他币种"],
  "Pay with the crypto you already have": ["Payez avec la crypto que vous avez déjà", "Paga con la cripto que ya tienes", "Pague com a cripto que você já tem", "Bezahle mit der Krypto, die du schon hast", "用您已有的加密货币支付"],
  "Your {chain} address": ["Votre adresse {chain}", "Tu dirección de {chain}", "Seu endereço {chain}", "Deine {chain}-Adresse", "您的 {chain} 地址"],
  "Only used to send your money back automatically if the conversion fails.": [
    "Utilisée uniquement pour vous rembourser automatiquement si la conversion échoue.", "Solo se usa para devolverte el dinero automáticamente si la conversión falla.",
    "Usado apenas para devolver seu dinheiro automaticamente se a conversão falhar.", "Wird nur genutzt, um dein Geld automatisch zurückzusenden, falls der Umtausch fehlschlägt.",
    "仅在兑换失败时用于自动退款。",
  ],
  "Get payment details": ["Obtenir les détails de paiement", "Obtener datos de pago", "Obter dados de pagamento", "Zahlungsdetails anzeigen", "获取付款信息"],
  "The exact amount, including network fees, is shown before you send anything.": [
    "Le montant exact, frais de réseau compris, s'affiche avant tout envoi.", "El monto exacto, con comisiones de red incluidas, se muestra antes de enviar nada.",
    "O valor exato, com taxas de rede incluídas, aparece antes de você enviar qualquer coisa.", "Der genaue Betrag inklusive Netzwerkgebühren wird angezeigt, bevor du etwas sendest.",
    "发送前会显示含网络费用的准确金额。",
  ],
  "Have {symbol} on NEAR? Pay from your NEAR wallet": ["Vous avez des {symbol} sur NEAR ? Payez depuis votre portefeuille NEAR", "¿Tienes {symbol} en NEAR? Paga desde tu billetera NEAR", "Tem {symbol} na NEAR? Pague pela sua carteira NEAR", "{symbol} auf NEAR? Mit deiner NEAR-Wallet bezahlen", "在 NEAR 上有 {symbol}？用 NEAR 钱包支付"],
  "Pay {amount} from {account}": ["Payer {amount} depuis {account}", "Pagar {amount} desde {account}", "Pagar {amount} de {account}", "{amount} von {account} bezahlen", "从 {account} 支付 {amount}"],
  "Connect a NEAR wallet": ["Connecter un portefeuille NEAR", "Conectar una billetera NEAR", "Conectar uma carteira NEAR", "NEAR-Wallet verbinden", "连接 NEAR 钱包"],

  // after paying
  "📅 Add to my calendar": ["📅 Ajouter à mon agenda", "📅 Añadir a mi calendario", "📅 Adicionar à minha agenda", "📅 Zu meinem Kalender hinzufügen", "📅 添加到我的日历"],
  "Didn't go through:": ["Échec :", "No se completó:", "Não foi concluído:", "Fehlgeschlagen:", "未成功："],
  "Thanks, you've paid 🔒": ["Merci, vous avez payé 🔒", "Gracias, ya pagaste 🔒", "Obrigado, você pagou 🔒", "Danke, du hast bezahlt 🔒", "谢谢，您已付款 🔒"],
  "{amount} is held safely. {name} has been told the money is there and is working on it. Work is due {date}.": [
    "{amount} sont bloqués en sécurité. {name} sait que l'argent est là et travaille sur votre projet. Le travail est attendu le {date}.",
    "{amount} quedan retenidos de forma segura. {name} sabe que el dinero está ahí y está trabajando en ello. La entrega es el {date}.",
    "{amount} estão guardados com segurança. {name} já sabe que o dinheiro está lá e está trabalhando nisso. A entrega é em {date}.",
    "{amount} werden sicher verwahrt. {name} weiß, dass das Geld da ist, und arbeitet daran. Fällig am {date}.",
    "{amount} 已安全托管。{name} 已得知款项到位，正在开展工作。截止日期为 {date}。",
  ],
  "Already happy with the work? Approve now": ["Déjà satisfait du travail ? Validez maintenant", "¿Ya estás satisfecho con el trabajo? Aprueba ahora", "Já está satisfeito com o trabalho? Aprove agora", "Schon zufrieden mit der Arbeit? Jetzt freigeben", "已满意？立即确认"],
  "Nothing delivered: refund me": ["Rien n'a été livré : me rembourser", "No se entregó nada: reembólsame", "Nada foi entregue: me reembolse", "Nichts geliefert: Geld zurück", "未交付：给我退款"],
  "Approved and paid. Thank you!": ["Validé et payé. Merci !", "Aprobado y pagado. ¡Gracias!", "Aprovado e pago. Obrigado!", "Freigegeben und bezahlt. Danke!", "已确认并放款，谢谢！"],
  "Refund on its way": ["Remboursement en cours", "Reembolso en camino", "Reembolso a caminho", "Erstattung ist unterwegs", "退款处理中"],
  "📦 The work has been delivered": ["📦 Le travail a été livré", "📦 El trabajo ha sido entregado", "📦 O trabalho foi entregue", "📦 Die Arbeit wurde geliefert", "📦 工作已交付"],
  "Please review it. If you're happy, approve and {name} is paid in seconds.": [
    "Merci de le vérifier. Si vous êtes satisfait, validez et {name} est payé en quelques secondes.",
    "Revísalo, por favor. Si estás satisfecho, aprueba y {name} recibe el pago en segundos.",
    "Por favor, confira. Se estiver satisfeito, aprove e {name} recebe em segundos.",
    "Bitte prüfe sie. Wenn du zufrieden bist, gib frei und {name} wird in Sekunden bezahlt.",
    "请查看。如果满意，点击确认，{name} 几秒内即可收款。",
  ],
  "If there's no response by **{date}**, payment is released automatically.": [
    "Sans réponse avant le **{date}**, le paiement est versé automatiquement.",
    "Si no hay respuesta antes del **{date}**, el pago se libera automáticamente.",
    "Se não houver resposta até **{date}**, o pagamento é liberado automaticamente.",
    "Ohne Antwort bis **{date}** wird die Zahlung automatisch freigegeben.",
    "如果在 **{date}** 前没有回应，款项将自动放出。",
  ],
  "Releasing payment… a few seconds": ["Versement en cours… quelques secondes", "Liberando el pago… unos segundos", "Liberando o pagamento… alguns segundos", "Zahlung wird freigegeben… ein paar Sekunden", "正在放款…只需几秒"],
  "Approve & release {amount}": ["Valider et verser {amount}", "Aprobar y liberar {amount}", "Aprovar e liberar {amount}", "Freigeben & {amount} auszahlen", "确认并放款 {amount}"],
  "Something's wrong? Report a problem": ["Un souci ? Signaler un problème", "¿Algo va mal? Reporta un problema", "Algo errado? Relate um problema", "Stimmt etwas nicht? Problem melden", "有问题？报告问题"],
  "What's missing or wrong?": ["Qu'est-ce qui manque ou ne va pas ?", "¿Qué falta o está mal?", "O que está faltando ou errado?", "Was fehlt oder ist falsch?", "缺少什么或哪里有问题？"],
  "The money stays frozen while you and the freelancer sort it out. You can agree a split, or a referee decides.": [
    "L'argent reste gelé pendant que vous trouvez une solution avec le freelance. Vous pouvez convenir d'un partage, ou un arbitre décide.",
    "El dinero queda congelado mientras tú y el freelancer lo resuelven. Pueden acordar un reparto, o decide un árbitro.",
    "O dinheiro fica congelado enquanto você e o freelancer resolvem. Vocês podem combinar uma divisão, ou um árbitro decide.",
    "Das Geld bleibt eingefroren, während du und der Freelancer das klären. Ihr könnt eine Aufteilung vereinbaren, oder ein Schiedsrichter entscheidet.",
    "在您和自由职业者协商期间，资金保持冻结。双方可以商定分配比例，或由仲裁人裁决。",
  ],
  "Freeze payment & report": ["Geler le paiement et signaler", "Congelar el pago y reportar", "Congelar o pagamento e relatar", "Zahlung einfrieren & melden", "冻结付款并报告"],
  "Problem reported. The money is frozen.": ["Problème signalé. L'argent est gelé.", "Problema reportado. El dinero está congelado.", "Problema relatado. O dinheiro está congelado.", "Problem gemeldet. Das Geld ist eingefroren.", "已报告问题，资金已冻结。"],
  "⚠️ Payment frozen": ["⚠️ Paiement gelé", "⚠️ Pago congelado", "⚠️ Pagamento congelado", "⚠️ Zahlung eingefroren", "⚠️ 付款已冻结"],
  "You reported: \"{reason}\"": ["Vous avez signalé : « {reason} »", "Reportaste: «{reason}»", "Você relatou: \"{reason}\"", "Du hast gemeldet: „{reason}“", "您报告的问题：“{reason}”"],
  "{name} offers: **{a}** to them, **{b}** back to you.": [
    "{name} propose : **{a}** pour lui, **{b}** remboursés à vous.", "{name} ofrece: **{a}** para él, **{b}** de vuelta para ti.",
    "{name} oferece: **{a}** para ele, **{b}** de volta para você.", "{name} bietet an: **{a}** für sich, **{b}** zurück an dich.",
    "{name} 提议：**{a}** 归对方，**{b}** 退还给您。",
  ],
  "Accept this split": ["Accepter ce partage", "Aceptar este reparto", "Aceitar esta divisão", "Diese Aufteilung annehmen", "接受此分配"],
  "Settled. Thanks for working it out.": ["Réglé. Merci d'avoir trouvé un accord.", "Resuelto. Gracias por llegar a un acuerdo.", "Resolvido. Obrigado por chegarem a um acordo.", "Geregelt. Danke, dass ihr euch geeinigt habt.", "已和解，感谢双方协商解决。"],
  "Offer a split: {pct}% to the freelancer ({amount})": ["Proposer un partage : {pct} % au freelance ({amount})", "Ofrecer un reparto: {pct}% para el freelancer ({amount})", "Oferecer uma divisão: {pct}% para o freelancer ({amount})", "Aufteilung anbieten: {pct} % an den Freelancer ({amount})", "提出分配：{pct}% 给自由职业者（{amount}）"],
  "Send this offer": ["Envoyer cette offre", "Enviar esta oferta", "Enviar esta oferta", "Angebot senden", "发送此提议"],
  "Offer sent": ["Offre envoyée", "Oferta enviada", "Oferta enviada", "Angebot gesendet", "提议已发送"],
  "If you can't agree, the referee ({arbiter}) decides.": ["Si vous ne trouvez pas d'accord, l'arbitre ({arbiter}) décide.", "Si no llegan a un acuerdo, decide el árbitro ({arbiter}).", "Se não houver acordo, o árbitro ({arbiter}) decide.", "Wenn ihr euch nicht einigt, entscheidet der Schiedsrichter ({arbiter}).", "如果无法达成一致，由仲裁人（{arbiter}）裁决。"],
  "If nothing is agreed within {days} days, it's split 50/50.": ["Sans accord sous {days} jours, le montant est partagé 50/50.", "Si no hay acuerdo en {days} días, se reparte 50/50.", "Se não houver acordo em {days} dias, o valor é dividido 50/50.", "Ohne Einigung innerhalb von {days} Tagen wird 50/50 geteilt.", "如果 {days} 天内未达成一致，将按 50/50 分配。"],
  "How was working with {name}?": ["Comment s'est passée la collaboration avec {name} ?", "¿Qué tal fue trabajar con {name}?", "Como foi trabalhar com {name}?", "Wie war die Zusammenarbeit mit {name}?", "与 {name} 合作的体验如何？"],
  "A few words for future clients (optional)": ["Quelques mots pour les futurs clients (facultatif)", "Unas palabras para futuros clientes (opcional)", "Algumas palavras para futuros clientes (opcional)", "Ein paar Worte für künftige Kunden (optional)", "给未来客户的几句话（可选）"],
  "Post rating": ["Publier la note", "Publicar valoración", "Publicar avaliação", "Bewertung abgeben", "提交评分"],
  "Thanks! Your rating is on their profile.": ["Merci ! Votre note est sur son profil.", "¡Gracias! Tu valoración está en su perfil.", "Obrigado! Sua avaliação está no perfil.", "Danke! Deine Bewertung steht im Profil.", "谢谢！您的评分已显示在对方资料中。"],
  "Only clients who actually paid can rate, once. Ratings can't be edited or deleted by anyone.": [
    "Seuls les clients qui ont réellement payé peuvent noter, une seule fois. Personne ne peut modifier ou supprimer une note.",
    "Solo los clientes que realmente pagaron pueden valorar, una vez. Nadie puede editar ni borrar las valoraciones.",
    "Só clientes que realmente pagaram podem avaliar, uma vez. Ninguém pode editar ou apagar avaliações.",
    "Nur Kunden, die wirklich bezahlt haben, können einmal bewerten. Niemand kann Bewertungen ändern oder löschen.",
    "只有真正付款的客户才能评分，且只能评一次。任何人都无法修改或删除评分。",
  ],
  "Thanks for paying with PayPact. You rated {name}": ["Merci d'avoir payé avec PayPact. Votre note pour {name} :", "Gracias por pagar con PayPact. Tu valoración de {name}:", "Obrigado por pagar com o PayPact. Sua avaliação de {name}:", "Danke, dass du mit PayPact bezahlt hast. Deine Bewertung für {name}:", "感谢使用 PayPact 付款。您给 {name} 的评分："],
  "Add a NEAR account for refunds (recommended)": ["Ajouter un compte NEAR pour les remboursements (recommandé)", "Añadir una cuenta NEAR para reembolsos (recomendado)", "Adicionar uma conta NEAR para reembolsos (recomendado)", "NEAR-Konto für Erstattungen hinzufügen (empfohlen)", "添加用于退款的 NEAR 账户（推荐）"],
  "Save": ["Enregistrer", "Guardar", "Salvar", "Speichern", "保存"],
  "Saved": ["Enregistré", "Guardado", "Salvo", "Gespeichert", "已保存"],
  "If any money comes back to you, it goes here.": ["Si de l'argent vous revient, il sera envoyé ici.", "Si te devuelven dinero, llegará aquí.", "Se algum dinheiro voltar para você, ele vem para cá.", "Falls Geld an dich zurückgeht, landet es hier.", "如有退款，将发送到这里。"],

  // control link
  "✅ Control link saved": ["✅ Lien de contrôle enregistré", "✅ Enlace de control guardado", "✅ Link de controle salvo", "✅ Steuerungslink gespeichert", "✅ 控制链接已保存"],
  "Show it again": ["L'afficher à nouveau", "Mostrarlo de nuevo", "Mostrar novamente", "Erneut anzeigen", "再次显示"],
  "🔑 Save your control link, it takes 5 seconds": ["🔑 Enregistrez votre lien de contrôle, 5 secondes suffisent", "🔑 Guarda tu enlace de control, toma 5 segundos", "🔑 Salve seu link de controle, leva 5 segundos", "🔑 Speichere deinen Steuerungslink, dauert 5 Sekunden", "🔑 保存您的控制链接，只需 5 秒"],
  "Your power to **approve the work or get your money back** is stored only in this browser. If you clear it or change phones, you'd lose that protection. Send this link **to yourself** so you can act from any device.": [
    "Votre pouvoir de **valider le travail ou récupérer votre argent** est stocké uniquement dans ce navigateur. Si vous l'effacez ou changez de téléphone, vous perdez cette protection. Envoyez-vous ce lien **à vous-même** pour agir depuis n'importe quel appareil.",
    "Tu poder para **aprobar el trabajo o recuperar tu dinero** se guarda solo en este navegador. Si lo borras o cambias de teléfono, perderías esa protección. Envíate este enlace **a ti mismo** para actuar desde cualquier dispositivo.",
    "Seu poder de **aprovar o trabalho ou recuperar seu dinheiro** fica guardado só neste navegador. Se você limpar os dados ou trocar de celular, perde essa proteção. Envie este link **para você mesmo** para agir de qualquer dispositivo.",
    "Deine Möglichkeit, **die Arbeit freizugeben oder dein Geld zurückzubekommen**, ist nur in diesem Browser gespeichert. Wenn du ihn löschst oder das Handy wechselst, verlierst du diesen Schutz. Schick dir diesen Link **selbst**, damit du von jedem Gerät aus handeln kannst.",
    "您**确认工作或取回资金**的权限仅保存在此浏览器中。如果清除数据或更换手机，您将失去这一保障。请把此链接**发给自己**，以便在任何设备上操作。",
  ],
  "WhatsApp (to myself)": ["WhatsApp (à moi-même)", "WhatsApp (a mí mismo)", "WhatsApp (para mim)", "WhatsApp (an mich)", "WhatsApp（发给自己）"],
  "Telegram (Saved Messages)": ["Telegram (Messages enregistrés)", "Telegram (Mensajes guardados)", "Telegram (Mensagens salvas)", "Telegram (Gespeicherte Nachrichten)", "Telegram（收藏夹）"],
  "Email it to me": ["Me l'envoyer par e-mail", "Enviármelo por correo", "Enviar para meu e-mail", "Per E-Mail an mich", "发到我的邮箱"],
  "Or copy it": ["Ou copiez-le", "O cópialo", "Ou copie", "Oder kopieren", "或复制链接"],
  "Keep it private: anyone with this link can approve or dispute for you. The freelancer never sees it.": [
    "Gardez-le privé : toute personne ayant ce lien peut valider ou contester à votre place. Le freelance ne le voit jamais.",
    "Mantenlo en privado: cualquiera con este enlace puede aprobar o disputar por ti. El freelancer nunca lo ve.",
    "Mantenha em sigilo: qualquer pessoa com este link pode aprovar ou contestar por você. O freelancer nunca o vê.",
    "Halte ihn privat: Wer diesen Link hat, kann für dich freigeben oder widersprechen. Der Freelancer sieht ihn nie.",
    "请妥善保管：任何拿到此链接的人都能代您确认或提出争议。自由职业者看不到它。",
  ],
  "My PayPact control link for \"{title}\" ({amount}). It lets me approve the work or report a problem from any device. Don't share it.": [
    "Mon lien de contrôle PayPact pour « {title} » ({amount}). Il me permet de valider le travail ou de signaler un problème depuis n'importe quel appareil. Ne pas partager.",
    "Mi enlace de control de PayPact para «{title}» ({amount}). Me permite aprobar el trabajo o reportar un problema desde cualquier dispositivo. No compartir.",
    "Meu link de controle do PayPact para \"{title}\" ({amount}). Ele me permite aprovar o trabalho ou relatar um problema de qualquer dispositivo. Não compartilhar.",
    "Mein PayPact-Steuerungslink für „{title}“ ({amount}). Damit kann ich die Arbeit von jedem Gerät aus freigeben oder ein Problem melden. Nicht teilen.",
    "我的 PayPact 控制链接：“{title}”（{amount}）。可在任何设备上确认工作或报告问题。请勿分享。",
  ],
  "PayPact: control link for invoice #{id}": ["PayPact : lien de contrôle de la facture n° {id}", "PayPact: enlace de control de la factura n.º {id}", "PayPact: link de controle da fatura nº {id}", "PayPact: Steuerungslink für Rechnung Nr. {id}", "PayPact：发票 #{id} 的控制链接"],

  // projects (milestones)
  "🔒 Locked. Due {date}.": ["🔒 Bloqué. À rendre le {date}.", "🔒 Bloqueado. Entrega el {date}.", "🔒 Bloqueado. Entrega em {date}.", "🔒 Gesichert. Fällig am {date}.", "🔒 已锁定，截止 {date}。"],
  "Not delivered: refund this milestone": ["Non livré : rembourser cette étape", "No entregado: reembolsar este hito", "Não entregue: reembolsar esta etapa", "Nicht geliefert: diesen Meilenstein erstatten", "未交付：退还此里程碑款项"],
  "Project #{id} · {n} milestones": ["Projet n° {id} · {n} étapes", "Proyecto n.º {id} · {n} hitos", "Projeto nº {id} · {n} etapas", "Projekt Nr. {id} · {n} Meilensteine", "项目 #{id} · {n} 个里程碑"],
  "✅ Completed": ["✅ Terminé", "✅ Completado", "✅ Concluído", "✅ Abgeschlossen", "✅ 已完成"],
  "🔒 {done} of {n} done": ["🔒 {done} sur {n} terminées", "🔒 {done} de {n} completados", "🔒 {done} de {n} concluídas", "🔒 {done} von {n} erledigt", "🔒 已完成 {done}/{n}"],
  "paid once, released milestone by milestone": ["payé en une fois, versé étape par étape", "pagado una vez, liberado hito a hito", "pago uma vez, liberado etapa por etapa", "einmal bezahlt, Meilenstein für Meilenstein ausgezahlt", "一次付清，按里程碑逐步放款"],
  "💸 **{paid}** paid out · 🔒 **{locked}** locked": ["💸 **{paid}** versés · 🔒 **{locked}** bloqués", "💸 **{paid}** pagados · 🔒 **{locked}** bloqueados", "💸 **{paid}** pagos · 🔒 **{locked}** bloqueados", "💸 **{paid}** ausgezahlt · 🔒 **{locked}** gesichert", "💸 已放款 **{paid}** · 🔒 锁定中 **{locked}**"],
  "↩️ **{amount}** refunded": ["↩️ **{amount}** remboursés", "↩️ **{amount}** reembolsados", "↩️ **{amount}** reembolsados", "↩️ **{amount}** erstattet", "↩️ 已退款 **{amount}**"],
  "**{amount} is held safely** by a smart contract. Each milestone's share is released only when you approve that milestone, and refunded to you if it isn't delivered by its due date. Not even PayPact can touch it.": [
    "**{amount} sont bloqués en sécurité** par un contrat intelligent. La part de chaque étape n'est versée que lorsque vous validez cette étape, et vous est remboursée si elle n'est pas livrée à temps. Même PayPact ne peut pas y toucher.",
    "**{amount} quedan retenidos de forma segura** por un contrato inteligente. La parte de cada hito solo se libera cuando apruebas ese hito, y se te reembolsa si no se entrega a tiempo. Ni siquiera PayPact puede tocarlos.",
    "**{amount} ficam guardados com segurança** por um contrato inteligente. A parte de cada etapa só é liberada quando você aprova essa etapa, e é reembolsada se não for entregue no prazo. Nem o PayPact pode mexer neles.",
    "**{amount} werden sicher verwahrt** von einem Smart Contract. Der Anteil jedes Meilensteins wird erst ausgezahlt, wenn du diesen Meilenstein freigibst, und dir erstattet, wenn er nicht rechtzeitig geliefert wird. Nicht einmal PayPact kann darauf zugreifen.",
    "**{amount} 由智能合约安全托管。**每个里程碑的款项只有在您确认该里程碑后才会放出；如果未按时交付，将退还给您。连 PayPact 也无法动用。",
  ],
  "You're the client. Demo Designer will make {n} posts this month for {total}. Pay once below: each post's share is released only when you approve that post.": [
    "Vous êtes le client. Demo Designer va réaliser {n} publications ce mois-ci pour {total}. Payez une seule fois ci-dessous : la part de chaque publication n'est versée que lorsque vous la validez.",
    "Eres el cliente. Demo Designer hará {n} publicaciones este mes por {total}. Paga una sola vez abajo: la parte de cada publicación solo se libera cuando la apruebas.",
    "Você é o cliente. Demo Designer vai fazer {n} posts este mês por {total}. Pague uma vez abaixo: a parte de cada post só é liberada quando você aprova esse post.",
    "Du bist der Kunde. Demo Designer erstellt diesen Monat {n} Posts für {total}. Zahle unten einmal: der Anteil jedes Posts wird erst ausgezahlt, wenn du ihn freigibst.",
    "您是客户。Demo Designer 将在本月为您制作 {n} 篇帖子，总价 {total}。请在下方一次付清：每篇帖子的款项只有在您确认后才会放出。",
  ],
  "{title} is delivered. Check it, then tap Approve & release below. Only this milestone's share is paid.": [
    "{title} est livré. Vérifiez-le, puis appuyez sur Valider et verser ci-dessous. Seule la part de cette étape est versée.",
    "{title} está entregado. Revísalo y toca Aprobar y liberar abajo. Solo se paga la parte de este hito.",
    "{title} foi entregue. Confira e toque em Aprovar e liberar abaixo. Só a parte desta etapa é paga.",
    "{title} ist geliefert. Prüfe es und tippe unten auf Freigeben & auszahlen. Nur der Anteil dieses Meilensteins wird gezahlt.",
    "{title} 已交付。查看后点击下方的确认并放款。只支付这个里程碑的款项。",
  ],
  "All the money is locked. Let Demo Designer deliver {title}:": [
    "Tout l'argent est bloqué. Laissez Demo Designer livrer {title} :", "Todo el dinero está bloqueado. Deja que Demo Designer entregue {title}:",
    "Todo o dinheiro está bloqueado. Deixe o Demo Designer entregar {title}:", "Das ganze Geld ist gesichert. Lass Demo Designer {title} liefern:",
    "全部资金已锁定。让 Demo Designer 交付 {title}：",
  ],
  "Every milestone is paid out. Rate Demo Designer below.": [
    "Toutes les étapes sont versées. Notez Demo Designer ci-dessous.", "Todos los hitos están pagados. Valora a Demo Designer abajo.",
    "Todas as etapas foram pagas. Avalie o Demo Designer abaixo.", "Alle Meilensteine sind ausgezahlt. Bewerte Demo Designer unten.",
    "所有里程碑均已放款。请在下方为 Demo Designer 评分。",
  ],
  "That's milestones: one payment, released piece by piece. Now try it for real.": [
    "Voilà les étapes : un seul paiement, versé morceau par morceau. Essayez maintenant pour de vrai.",
    "Así funcionan los hitos: un solo pago, liberado por partes. Ahora pruébalo de verdad.",
    "Assim funcionam as etapas: um pagamento, liberado parte por parte. Agora experimente de verdade.",
    "So funktionieren Meilensteine: eine Zahlung, Stück für Stück ausgezahlt. Probier es jetzt richtig aus.",
    "这就是里程碑：一次付款，分批放款。现在来真的试试吧。",
  ],
  "▶ Demo · project with {n} milestones": ["▶ Démo · projet en {n} étapes", "▶ Demo · proyecto con {n} hitos", "▶ Demo · projeto com {n} etapas", "▶ Demo · Projekt mit {n} Meilensteinen", "▶ 演示 · {n} 个里程碑的项目"],
  "Demo Designer delivers {title}": ["Demo Designer livre {title}", "Demo Designer entrega {title}", "Demo Designer entrega {title}", "Demo Designer liefert {title}", "Demo Designer 交付 {title}"],

  // shared bits
  "Copy": ["Copier", "Copiar", "Copiar", "Kopieren", "复制"],
  "Copied": ["Copié", "Copiado", "Copiado", "Kopiert", "已复制"],
};
