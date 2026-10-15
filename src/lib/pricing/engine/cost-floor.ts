/**
 * Cost floor: what the job costs the studio before any margin. Every line is
 * costed exactly once from an explicit assumption (defaults below, owner
 * overrides allowed) and carries its basis in words. Shooting, prep, travel,
 * culling and editing per expected image, video editing per deliverable
 * (full-match filming, edited highlights and reels are costed differently),
 * admin, partner crew, allocated overhead, equipment allowance and a
 * contingency. The payment fee is NOT a cost line: it is a share of the
 * price and lives in the recommendation's formula.
 * Pure and deterministic.
 */
import type { Assumption, CostAssumptions, CostFloor, CostLine, PricingRequest } from "./types";
import { round2 } from "./types";

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  ownerHourlyQr: 150,
  partnerVideographerDayQr: 900,
  secondShooterDayQr: 600,
  prepHoursPerDay: 1,
  travelHoursPerDay: 1.5,
  travelCostPerDayQr: 60,
  cullingHoursPer100Images: 1,
  editingMinutesPerImage: 4,
  imagesPerShootHour: 20,
  imagesPerAthlete: 15,
  imagesPerPortraitSession: 10,
  fullMatchEditHoursPerFootageHour: 0.75,
  highlightEditHours: 4,
  reelEditHours: 2.5,
  rawFootageHandlingHoursPerFootageHour: 0.5,
  adminHours: 1,
  overheadPerShootDayQr: 100,
  equipmentPerShootDayQr: 75,
  paymentFeePercent: 2.5,
  contingencyPercent: 5,
  matsPerShooter: 2,
  matchesPerAthlete: 1,
  minutesPerMatch: 8,
  shooterUtilisation: 0.7,
  reelsPerContentDay: 3,
};

const ASSUMPTION_LABEL: Record<keyof CostAssumptions, string> = {
  ownerHourlyQr: "Owner labour (QAR per hour)",
  partnerVideographerDayQr: "Videographer partner (QAR per day)",
  secondShooterDayQr: "Second photographer (QAR per day)",
  prepHoursPerDay: "Prep hours per shoot day",
  travelHoursPerDay: "Travel hours per shoot day",
  travelCostPerDayQr: "Travel cost per shoot day (QAR)",
  cullingHoursPer100Images: "Culling hours per 100 delivered images",
  editingMinutesPerImage: "Editing minutes per delivered image",
  imagesPerShootHour: "Delivered images per shoot hour",
  imagesPerAthlete: "Delivered images per athlete",
  imagesPerPortraitSession: "Delivered images per portrait session",
  fullMatchEditHoursPerFootageHour: "Full-match edit hours per footage hour",
  highlightEditHours: "Edit hours per highlight film",
  reelEditHours: "Edit hours per reel",
  rawFootageHandlingHoursPerFootageHour: "Raw footage handling hours per footage hour",
  adminHours: "Admin hours per job",
  overheadPerShootDayQr: "Allocated overhead per shoot day (QAR)",
  equipmentPerShootDayQr: "Equipment allowance per shoot day (QAR)",
  paymentFeePercent: "Payment fee (% of price)",
  contingencyPercent: "Contingency (% of costs)",
  matsPerShooter: "Mats one photographer can cover",
  matchesPerAthlete: "Expected matches per athlete",
  minutesPerMatch: "Minutes per match",
  shooterUtilisation: "Share of on-site time that can be matches",
  reelsPerContentDay: "Reels per content day when not stated",
};

/** Merges owner overrides onto the defaults; non-finite or negative values are ignored. */
export function resolveCostAssumptions(overrides: Partial<CostAssumptions> | null | undefined): { assumptions: CostAssumptions; list: Assumption[] } {
  const out: CostAssumptions = { ...DEFAULT_COST_ASSUMPTIONS };
  const list: Assumption[] = [];
  for (const key of Object.keys(DEFAULT_COST_ASSUMPTIONS) as Array<keyof CostAssumptions>) {
    const v = overrides?.[key];
    const owner = typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (owner) out[key] = v;
    list.push({ key, label: ASSUMPTION_LABEL[key], value: out[key], source: owner ? "owner" : "default" });
  }
  return { assumptions: out, list };
}

function hoursLine(key: string, label: string, hours: number, rate: number, basis: string): CostLine {
  return { key, label, hours: round2(hours), rate, amount: round2(hours * rate), basis };
}

export function computeCostFloor(req: PricingRequest, overrides: Partial<CostAssumptions> | null = null): CostFloor {
  const { assumptions: a, list } = resolveCostAssumptions(overrides);
  const lines: CostLine[] = [];
  const warnings: string[] = [];
  const derived: Assumption[] = [];
  const days = Math.max(1, req.days);
  const hoursPerDay = req.hoursOnSite ?? 0;
  const shootHours = round2(hoursPerDay * days);
  const sports = req.service === "tournament_athlete" || req.service === "team_tournament" || req.service === "organizer_custom";
  const wantsVideo = req.media !== "photo";
  const wantsPhoto = req.media !== "video";

  // Staffing --------------------------------------------------------------------
  const mats = sports ? Math.max(1, req.simultaneousMats ?? 1) : 1;
  let shooters = wantsPhoto ? Math.max(1, Math.ceil(mats / a.matsPerShooter)) : 0;
  let staffingBasis = wantsPhoto ? `${mats} mat${mats === 1 ? "" : "s"} ÷ ${a.matsPerShooter} per photographer = ${shooters} photographer${shooters === 1 ? "" : "s"}` : "No photographer: video only";
  if (sports && wantsPhoto && req.athleteCount && req.athleteCount > 1) {
    // Roster workload: expected match minutes against what one shooter can actually be on a mat for.
    const matchMinutes = req.athleteCount * a.matchesPerAthlete * a.minutesPerMatch;
    const perShooterMinutes = Math.max(1, shootHours * 60 * a.shooterUtilisation);
    const byWorkload = Math.ceil(matchMinutes / perShooterMinutes);
    if (byWorkload > shooters) {
      shooters = byWorkload;
      staffingBasis = `${req.athleteCount} athletes × ${a.matchesPerAthlete} match × ${a.minutesPerMatch} min = ${matchMinutes} match-minutes; one photographer covers ${Math.round(perShooterMinutes)} min on a ${shootHours} h day → ${shooters} photographers`;
    } else staffingBasis += `; ${req.athleteCount} athletes × ${a.matchesPerAthlete} match fit that crew`;
  }
  const needsPerMatCamera = wantsVideo && (req.videoDeliverables.includes("full_match") || req.videoDeliverables.includes("raw_footage"));
  const videographers = wantsVideo ? (needsPerMatCamera && sports ? Math.max(1, mats) : 1) : 0;
  if (videographers) staffingBasis += `; ${videographers} videographer${videographers === 1 ? "" : "s"}${needsPerMatCamera && sports ? " (one camera per mat for full matches)" : ""}`;
  const crew = shooters + videographers;

  // Owner time on site, prep, travel ---------------------------------------------------
  const ownerOnSite = wantsPhoto ? shootHours : 0;
  if (ownerOnSite > 0) lines.push(hoursLine("shooting", "Shooting (owner)", ownerOnSite, a.ownerHourlyQr, `${hoursPerDay} h × ${days} day${days === 1 ? "" : "s"} × ${a.ownerHourlyQr} QAR/h`));
  else if (wantsPhoto) warnings.push("Hours on site are 0; shooting time is not costed.");
  lines.push(hoursLine("prep", "Preparation", a.prepHoursPerDay * days, a.ownerHourlyQr, `${a.prepHoursPerDay} h × ${days} day${days === 1 ? "" : "s"}`));
  lines.push(hoursLine("travel_time", "Travel time", a.travelHoursPerDay * days, a.ownerHourlyQr, `${a.travelHoursPerDay} h × ${days} day${days === 1 ? "" : "s"}${req.locationKind === "studio" ? " (studio: still counted once)" : ""}`));
  lines.push({ key: "travel_cost", label: "Travel cost", hours: null, rate: null, amount: round2(a.travelCostPerDayQr * days), basis: `${a.travelCostPerDayQr} QAR × ${days} day${days === 1 ? "" : "s"}` });

  // Expected images → culling + editing ---------------------------------------------
  let expectedImages = 0;
  if (wantsPhoto) {
    if (req.expectedImages !== null) expectedImages = req.expectedImages;
    else if (req.service === "athlete_portrait") {
      expectedImages = a.imagesPerPortraitSession;
      derived.push({ key: "expected_images", label: "Expected delivered images", value: expectedImages, source: "default" });
    } else if ((req.service === "tournament_athlete" || req.service === "team_tournament") && req.athleteCount) {
      expectedImages = Math.round(req.athleteCount * a.imagesPerAthlete * a.matchesPerAthlete);
      derived.push({ key: "expected_images", label: "Expected delivered images", value: `${req.athleteCount} athletes × ${a.imagesPerAthlete} × ${a.matchesPerAthlete} match = ${expectedImages}`, source: "default" });
    } else {
      expectedImages = Math.round(shootHours * a.imagesPerShootHour);
      derived.push({ key: "expected_images", label: "Expected delivered images", value: `${shootHours} h × ${a.imagesPerShootHour} = ${expectedImages}`, source: "default" });
    }
    const culling = (expectedImages / 100) * a.cullingHoursPer100Images;
    const editing = (expectedImages * a.editingMinutesPerImage) / 60;
    lines.push(hoursLine("culling", "Culling", culling, a.ownerHourlyQr, `${expectedImages} images × ${a.cullingHoursPer100Images} h per 100`));
    lines.push(hoursLine("editing_photo", "Photo editing", editing, a.ownerHourlyQr, `${expectedImages} images × ${a.editingMinutesPerImage} min`));
  }

  // Video deliverables, each costed on its own -------------------------------------------
  const video = { fullMatchFootageHours: 0, highlights: 0, reels: 0, rawFootageHours: 0 };
  if (wantsVideo) {
    const footageHours = round2(shootHours * Math.max(1, videographers));
    for (const d of req.videoDeliverables) {
      if (d === "full_match") {
        video.fullMatchFootageHours = footageHours;
        lines.push(hoursLine("video_full_match", "Full-match films (trim + export)", footageHours * a.fullMatchEditHoursPerFootageHour, a.ownerHourlyQr, `${footageHours} h of footage × ${a.fullMatchEditHoursPerFootageHour} h`));
      } else if (d === "edited_highlights") {
        video.highlights = req.service === "tournament_athlete" ? Math.max(1, req.athleteCount ?? 1) : 1;
        derived.push({ key: "highlights", label: "Highlight films", value: video.highlights, source: "default" });
        lines.push(hoursLine("video_highlights", "Edited highlights", video.highlights * a.highlightEditHours, a.ownerHourlyQr, `${video.highlights} film${video.highlights === 1 ? "" : "s"} × ${a.highlightEditHours} h`));
      } else if (d === "reels") {
        video.reels = a.reelsPerContentDay * days;
        derived.push({ key: "reels", label: "Reels", value: video.reels, source: "default" });
        lines.push(hoursLine("video_reels", "Reels", video.reels * a.reelEditHours, a.ownerHourlyQr, `${video.reels} reel${video.reels === 1 ? "" : "s"} × ${a.reelEditHours} h`));
      } else if (d === "raw_footage") {
        video.rawFootageHours = footageHours;
        lines.push(hoursLine("video_raw", "Raw footage handling", footageHours * a.rawFootageHandlingHoursPerFootageHour, a.ownerHourlyQr, `${footageHours} h × ${a.rawFootageHandlingHoursPerFootageHour} h`));
      }
    }
  }

  // Admin, partners, overhead, equipment ----------------------------------------------------
  lines.push(hoursLine("admin", "Admin (quote, agreement, delivery)", a.adminHours, a.ownerHourlyQr, `${a.adminHours} h once per job`));
  if (videographers) lines.push({ key: "partner_video", label: "Videographer partner", hours: null, rate: a.partnerVideographerDayQr, amount: round2(videographers * a.partnerVideographerDayQr * days), basis: `${videographers} × ${a.partnerVideographerDayQr} QAR × ${days} day${days === 1 ? "" : "s"}` });
  if (shooters > 1) lines.push({ key: "second_shooter", label: "Additional photographers", hours: null, rate: a.secondShooterDayQr, amount: round2((shooters - 1) * a.secondShooterDayQr * days), basis: `${shooters - 1} × ${a.secondShooterDayQr} QAR × ${days} day${days === 1 ? "" : "s"}` });
  lines.push({ key: "overhead", label: "Allocated overhead", hours: null, rate: null, amount: round2(a.overheadPerShootDayQr * days), basis: `${a.overheadPerShootDayQr} QAR × ${days} day${days === 1 ? "" : "s"}` });
  lines.push({ key: "equipment", label: "Equipment allowance", hours: null, rate: null, amount: round2(a.equipmentPerShootDayQr * days), basis: `${a.equipmentPerShootDayQr} QAR × ${days} day${days === 1 ? "" : "s"}` });

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const contingency = round2(subtotal * (a.contingencyPercent / 100));
  const total = round2(subtotal + contingency);
  const ownerHours = round2(lines.reduce((s, l) => s + (l.hours ?? 0), 0));
  const editingHours = round2(lines.filter((l) => l.key.startsWith("editing") || l.key.startsWith("video_") || l.key === "culling").reduce((s, l) => s + (l.hours ?? 0), 0));
  if (req.deadlineDays !== null && editingHours / 6 > req.deadlineDays) warnings.push(`About ${Math.ceil(editingHours / 6)} working days of editing against a ${req.deadlineDays}-day deadline.`);
  if (req.criticalMissing.length) warnings.push(`Costed on assumptions for: ${req.criticalMissing.join(", ")}.`);

  return {
    lines,
    subtotal,
    contingency,
    total,
    staffing: { shooters, videographers, crew, basis: staffingBasis },
    workload: { shootHours, ownerHours, editingHours, expectedImages, video },
    assumptions: [...list, ...derived],
    warnings,
  };
}
