const prisma = require("../prisma");

// Purge des brouillons de précommande (statut DRAFT) jamais finalisés.
//
// Depuis la simplification de l'étape 1 (catalogue-avant-identité), le
// consentement RGPD n'est plus exigé pour créer un brouillon : seul le
// numéro FBO l'est (voir createDraft() dans preorders.controller.js). Le
// nom et le numéro FBO du client partent donc vers le serveur avant tout
// consentement explicite. Ce job applique le principe de limitation de la
// conservation (RGPD art. 5.1.e) en supprimant les brouillons abandonnés
// au-delà d'un délai raisonnable, qu'ils aient ou non atteint le
// consentement à l'étape du récapitulatif.
//
// La suppression du Preorder cascade sur ses items/logs/messages/paiements
// (onDelete: Cascade côté schema.prisma) ; le enregistrement Fbo associé
// (annuaire distributeur, réutilisé par d'autres précommandes) n'est jamais
// touché par ce job.

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Désactivé par défaut (opt-in explicite) : un premier passage en prod
// purgerait plusieurs milliers de DRAFT historiques d'un coup (constaté :
// 6193 lignes de plus de 30 jours). Ne pas activer sans avoir d'abord
// vérifié/exporté ces brouillons si des statistiques d'abandon en dépendent.
function isPurgeEnabled() {
  return String(process.env.PREORDER_DRAFT_PURGE_ENABLED ?? "false").toLowerCase() === "true";
}

function getDraftRetentionDays() {
  return parsePositiveInt(process.env.PREORDER_DRAFT_RETENTION_DAYS, 30);
}

function getSchedulerEveryHours() {
  return parsePositiveInt(process.env.PREORDER_DRAFT_PURGE_CHECK_EVERY_HOURS, 6);
}

function buildRetentionCutoff(now = new Date(), retentionDays = getDraftRetentionDays()) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Supprime les précommandes restées en statut DRAFT plus longtemps que le
 * délai de rétention configuré. dryRun permet d'obtenir le décompte sans
 * rien supprimer (utile pour vérifier l'impact avant activation).
 */
async function purgeAbandonedDrafts({ now = new Date(), dryRun = false } = {}) {
  const retentionDays = getDraftRetentionDays();
  const cutoff = buildRetentionCutoff(now, retentionDays);

  const where = {
    status: "DRAFT",
    createdAt: { lt: cutoff },
  };

  if (dryRun) {
    const count = await prisma.preorder.count({ where });
    return {
      ok: true,
      dryRun: true,
      retentionDays,
      cutoff: cutoff.toISOString(),
      purgedCount: count,
    };
  }

  const candidates = await prisma.preorder.findMany({
    where,
    select: { id: true },
    take: 500,
  });

  if (!candidates.length) {
    return {
      ok: true,
      dryRun: false,
      retentionDays,
      cutoff: cutoff.toISOString(),
      purgedCount: 0,
    };
  }

  const { count } = await prisma.preorder.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });

  return {
    ok: true,
    dryRun: false,
    retentionDays,
    cutoff: cutoff.toISOString(),
    purgedCount: count,
  };
}

function startDraftRetentionScheduler() {
  if (!isPurgeEnabled()) {
    console.info("[preorder-draft-retention] scheduler disabled via PREORDER_DRAFT_PURGE_ENABLED");
    return null;
  }

  const intervalMs = getSchedulerEveryHours() * 60 * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await purgeAbandonedDrafts({ now: new Date() });
      if (result.purgedCount > 0) {
        console.log("[preorder-draft-retention] purge summary", result);
      }
    } catch (error) {
      console.error("[preorder-draft-retention] scheduler error", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  tick().catch(() => {});
  return timer;
}

module.exports = {
  buildRetentionCutoff,
  getDraftRetentionDays,
  purgeAbandonedDrafts,
  startDraftRetentionScheduler,
};
