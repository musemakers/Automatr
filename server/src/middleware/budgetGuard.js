import { monthSpendUsd, generationUsage } from '../services/customerService.js';

/**
 * Blocks AI-generation requests (HTTP 402) once a customer has used up its monthly budget,
 * when the agency has turned enforcement on for that customer. Spend is the estimated cost
 * already logged in AiUsageLog this calendar month. Must run after requireAuth.
 */
export async function enforceBudget(req, res, next) {
  try {
    const b = req.customer?.budget;
    if (!b?.enforce || b.monthlyUsd === null || b.monthlyUsd === undefined) return next();
    const spent = await monthSpendUsd(req.customer._id);
    if (spent >= b.monthlyUsd) {
      return res.status(402).json({
        error: `This workspace has reached its monthly AI budget ($${b.monthlyUsd.toFixed(2)}). Contact your agency to raise it.`,
        code: 'BUDGET_EXCEEDED',
        spentUsd: Number(spent.toFixed(4)),
        budgetUsd: b.monthlyUsd
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * True when an agency admin (superadmin) is looking at a CUSTOMER's workspace (anything other than the admin's own
 * workspace). In that view the agency can look around and manage settings, but cannot create anything.
 */
export function viewingCustomerWorkspace(req) {
  return req.user?.role === 'admin' && Boolean(req.customer) && String(req.customer._id) !== String(req.user.customer || '');
}

/**
 * Superadmins may not create creatives (documents, images, videos, edits) while viewing a customer's workspace:
 * everything in a customer's workspace is made by that customer's own team, so its Completed list, Usage page and
 * allowance stay true. Use ahead of any handler that creates or generates a creative. Must run after requireAuth.
 */
export function blockSuperadminCreation(req, res, next) {
  if (viewingCustomerWorkspace(req)) {
    return res.status(403).json({
      error: `You are viewing ${req.customer?.name || "this customer"}'s workspace as an agency admin. Creatives can only be made by the customer's own team here.`,
      code: 'SUPERADMIN_VIEW_ONLY'
    });
  }
  return next();
}

/**
 * Enforces the customer's monthly image / video cap on a generation route (restrictGeneration('image') or
 * restrictGeneration('video')), and refuses superadmins in a customer's workspace. Must run after requireAuth.
 */
export function restrictGeneration(kind) {
  return async function restrictGenerationMiddleware(req, res, next) {
    try {
      if (viewingCustomerWorkspace(req)) return blockSuperadminCreation(req, res, next);
      if (req.user?.role === 'admin') return next(); // superadmin in the agency's own workspace: no caps
      // Monthly cap (cycle starts on the day the customer was created).
      const base = kind === 'video' ? req.customer?.limits?.videosPerMonth : req.customer?.limits?.imagesPerMonth;
      if (base === null || base === undefined) return next();
      const usage = await generationUsage(req.customer);
      const meter = kind === 'video' ? usage.videos : usage.images;
      const used = meter.used;
      const cap = meter.limit; // monthly limit + any top-ups granted this cycle
      if (used >= cap) {
        return res.status(403).json({
          error: `This workspace has used all ${cap} ${kind === 'video' ? 'video' : 'image'} generations ${usage.cycleEnd ? `for this month. It renews on ${usage.cycleEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : 'in its one-time package'}. Contact your agency to ${usage.cycleEnd ? 'raise the limit' : 'add more'}.`,
          code: 'MONTHLY_LIMIT_REACHED',
          kind,
          used,
          limit: cap,
          renewsAt: usage.cycleEnd
        });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
