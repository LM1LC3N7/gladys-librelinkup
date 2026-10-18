// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button, errors). Errors
// thrown to Gladys are English (one language per message, like the core's);
// the statuses and button answers are { en, fr }. No text ever holds the
// e-mail address, the password, a patient name nor a glucose value.
// -----------------------------------------------------------------------------

import { LLU_VERSION } from './constants.js';
import { CODES } from './llu/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
/** French: 0 and 1 take the singular ("0 patient"). */
const pluralFr = (n, one, many) => (n <= 1 ? one : many);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** A delay in words: minutes below 1 h, hours above. */
const delayText = (ms) => {
  const m = minutes(ms);
  if (m < 60) return { en: `${m} min`, fr: `${m} min` };
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const t = rest ? `${h} h ${rest} min` : `${h} h`;
  return { en: t, fr: t };
};

/** Why LibreLinkUp failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.TLS_UNTRUSTED:
      return { en: 'certificate not trusted', fr: 'certificat non reconnu' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

/** What the API asks to do in the app, in words. */
const stepText = (step) => {
  if (step === 'pp') {
    return {
      en: 'accept the new privacy policy',
      fr: 'd’accepter la nouvelle politique de confidentialité',
    };
  }
  if (step === 'verifyEmail') {
    return { en: 'verify the e-mail address', fr: 'de vérifier l’adresse e-mail' };
  }
  return {
    en: 'accept the new terms of use',
    fr: 'd’accepter les nouvelles conditions d’utilisation',
  };
};

const RETRY = (delay) => {
  const d = delayText(delay);
  return { en: `Retried in ${d.en}.`, fr: `Nouvel essai dans ${d.fr}.` };
};

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ total, stale, capped }) =>
      join(
        {
          en: `LibreLinkUp answers: ${total} ${plural(total, 'patient', 'patients')}, ${stale} without a measurement for 15 min or more.`,
          fr: `LibreLinkUp répond : ${total} ${pluralFr(total, 'patient', 'patients')}, ${stale} sans mesure depuis 15 min ou plus.`,
        },
        capped > 0
          ? {
              en: `${capped} more ${plural(capped, 'patient is', 'patients are')} left out (20 at most).`,
              fr: `${capped} ${pluralFr(capped, 'autre patient est ignoré', 'autres patients sont ignorés')} (20 au plus).`,
            }
          : {},
      ),
    noDevice: {
      en: 'LibreLinkUp answers, but the account follows no patient: accept a sharing invitation in the LibreLinkUp app first.',
      fr: 'LibreLinkUp répond, mais le compte ne suit aucun patient : acceptez d’abord une invitation de partage dans l’application LibreLinkUp.',
    },
    missingCredentials: {
      en: 'Type the e-mail address and the password of your LibreLinkUp account (the ones of the LibreLinkUp app).',
      fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte LibreLinkUp (ceux de l’application LibreLinkUp).',
    },
    emailInvalid: {
      en: 'The e-mail address is not valid (a line break, a space or no "@"?): type it again. Nothing was sent.',
      fr: 'L’adresse e-mail n’est pas valide (retour à la ligne, espace ou pas de « @ » ?) : saisissez-la de nouveau. Rien n’a été envoyé.',
    },
    passwordInvalid: {
      en: 'The password holds a line break or a control character (pasted?): type it again. Nothing was sent.',
      fr: 'Le mot de passe contient un retour à la ligne ou un caractère de contrôle (collé ?) : saisissez-le de nouveau. Rien n’a été envoyé.',
    },
    configUnreadable: {
      en: 'Gladys did not give the configuration of the integration: read again in 1 min.',
      fr: 'Gladys n’a pas transmis la configuration de l’intégration : nouvelle lecture dans 1 min.',
    },
    refused: (delay) =>
      join({
        en: `LibreLinkUp refused the e-mail address or the password. A wrong password tried again and again locks the account: Gladys stops for ${delayText(delay).en} (1 h, then 6 h, then 24 h). Saving the configuration tries once per series of refusals (other credentials: at once).`,
        fr: `LibreLinkUp a refusé l’adresse e-mail ou le mot de passe. Un mauvais mot de passe essayé encore et encore bloque le compte : Gladys s’arrête ${delayText(delay).fr} (1 h, puis 6 h, puis 24 h). Enregistrer la configuration fait un essai par série de refus (d’autres identifiants : tout de suite).`,
      }),
    terms: (step, delay) => {
      const s = stepText(step);
      return {
        en: `LibreLinkUp asks to ${s.en}: open the LibreLinkUp app with this account and do it there (Gladys never accepts anything for you), then save the configuration of the integration. Next attempt in ${delayText(delay).en} otherwise.`,
        fr: `LibreLinkUp demande ${s.fr} : ouvrez l’application LibreLinkUp avec ce compte et faites-le là (Gladys n’accepte jamais rien à votre place), puis enregistrez la configuration de l’intégration. Sinon, prochain essai dans ${delayText(delay).fr}.`,
      };
    },
    stillRefused: (delay, forced = false, terms = false) => {
      const what = terms
        ? {
            en: 'LibreLinkUp asked earlier to accept new terms in its app',
            fr: 'LibreLinkUp a demandé plus tôt d’accepter de nouvelles conditions dans son application',
          }
        : {
            en: 'LibreLinkUp refused these credentials earlier',
            fr: 'LibreLinkUp a refusé ces identifiants plus tôt',
          };
      return forced
        ? {
            en: `${what.en}, and they were already tried again: next attempt in ${delayText(delay).en} (other credentials are tried at once).`,
            fr: `${what.fr}, et ils ont déjà été réessayés : prochain essai dans ${delayText(delay).fr} (d’autres identifiants sont essayés tout de suite).`,
          }
        : {
            en: `${what.en}: Gladys waits ${delayText(delay).en} before trying again (saving the configuration tries once at once).`,
            fr: `${what.fr} : Gladys attend ${delayText(delay).fr} avant de réessayer (enregistrer la configuration fait un essai tout de suite).`,
          };
    },
    alreadyRetried: (delay) => ({
      en: `Already tried again after this stop: next attempt in ${delayText(delay).en}. Saving the same credentials again does not shorten the stop (other credentials are tried at once).`,
      fr: `Déjà réessayé après cet arrêt : prochain essai dans ${delayText(delay).fr}. Enregistrer de nouveau les mêmes identifiants ne raccourcit pas l’arrêt (d’autres identifiants sont essayés tout de suite).`,
    }),
    version: (delay) =>
      join(
        {
          en: `The LibreLinkUp API refuses the app version the integration sends (${LLU_VERSION}): update the integration (or report it on the Gladys forum).`,
          fr: `L’API LibreLinkUp refuse la version d’application envoyée par l’intégration (${LLU_VERSION}) : mettez l’intégration à jour (ou signalez-le sur le forum Gladys).`,
        },
        RETRY(delay),
      ),
    region: (delay) =>
      join(
        {
          en: 'LibreLinkUp sent the account to a region outside the list of official LibreLinkUp hosts: nothing was sent there (report it on the Gladys forum).',
          fr: 'LibreLinkUp a envoyé le compte vers une région hors de la liste des hôtes officiels LibreLinkUp : rien n’y a été envoyé (signalez-le sur le forum Gladys).',
        },
        RETRY(delay),
      ),
    internal: (delay) =>
      join(
        {
          en: 'Internal error of the integration while reading the answer of LibreLinkUp (see the logs of the integration).',
          fr: 'Erreur interne de l’intégration en lisant la réponse de LibreLinkUp (voir les journaux de l’intégration).',
        },
        RETRY(delay),
      ),
    tooLarge: (delay) =>
      join(
        {
          en: 'LibreLinkUp answers, but the answer is too large (above 1 MB).',
          fr: 'LibreLinkUp répond, mais la réponse est trop grande (plus de 1 Mo).',
        },
        RETRY(delay),
      ),
    tlsUntrusted: (delay) =>
      join(
        {
          en: 'The certificate of the LibreLinkUp API is not trusted: nothing was sent (a proxy or a firewall in between?).',
          fr: 'Le certificat de l’API LibreLinkUp n’est pas reconnu : rien n’a été envoyé (un proxy ou un pare-feu entre les deux ?).',
        },
        RETRY(delay),
      ),
    forbidden: (delay) =>
      join(
        {
          en: 'Access refused (HTTP 403) by LibreLinkUp or by something in between (a firewall, a proxy?).',
          fr: 'Accès refusé (HTTP 403) par LibreLinkUp ou par un intermédiaire (un pare-feu, un proxy ?).',
        },
        RETRY(delay),
      ),
    badAnswer: (delay) =>
      join(
        {
          en: 'The LibreLinkUp API answers in an unexpected way (it may have changed).',
          fr: 'L’API LibreLinkUp répond de façon inattendue (elle a peut-être changé).',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'LibreLinkUp asks Gladys to slow down (HTTP 429, or too many logins): every request is paused.',
          fr: 'LibreLinkUp demande à Gladys de ralentir (HTTP 429, ou trop de connexions) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `LibreLinkUp answers with a server error (HTTP ${status}, maintenance?): every request is paused.`,
          fr: `LibreLinkUp répond par une erreur serveur (HTTP ${status}, maintenance ?) : toutes les requêtes sont suspendues.`,
        },
        RETRY(delay),
      ),
    paused: (delay) =>
      join(
        {
          en: 'LibreLinkUp asked Gladys to wait (HTTP 429 or a server error): the pause goes on.',
          fr: 'LibreLinkUp a demandé à Gladys d’attendre (HTTP 429 ou erreur serveur) : la pause continue.',
        },
        RETRY(delay),
      ),
    retryPending: (delay) =>
      join(
        {
          en: 'The last reading of LibreLinkUp failed (before the restart of the integration).',
          fr: 'La dernière lecture de LibreLinkUp a échoué (avant le redémarrage de l’intégration).',
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'LibreLinkUp does not answer:', fr: 'LibreLinkUp ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ total }) => ({
      en: `Connected: ${total} ${plural(total, 'patient', 'patients')}. Add them from the Discovery tab.`,
      fr: `Connecté : ${total} ${pluralFr(total, 'patient', 'patients')}. Ajoutez-les depuis l’onglet Découverte.`,
    }),
  },
  errors: {
    readOnly: 'This integration only reads LibreLinkUp: nothing can be changed from Gladys',
    notConnected: 'LibreLinkUp is not connected: see the configuration of the integration',
    testTooLong:
      'LibreLinkUp has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};
