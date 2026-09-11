# Personal training and calorie counting methodology

STRATA’s coaching workspace is a planning tool for adults, not a diagnosis, a measured metabolic test, or medical nutrition therapy. Every saved week includes the inputs, formula name, assumptions, safety limits, and generation version behind its results.

## Energy estimates

When body-fat percentage is not supplied, STRATA estimates resting energy with the sex-specific Mifflin–St Jeor equation. The [original validation study](https://pubmed.ncbi.nlm.nih.gov/2305711/) derived the equation from indirect-calorimetry measurements in 498 healthy adults. The form calls this value an equation input rather than gender identity because it selects one of the two published coefficients.

When body-fat percentage is supplied, STRATA uses `370 + 21.6 × fat-free mass`, commonly called the Katch–McArdle lean-mass equation and reported in [Cunningham's resting-energy synthesis](https://pubmed.ncbi.nlm.nih.gov/1957828/). Consumer body-fat readings can be inaccurate, so this route is still labeled an estimate. STRATA multiplies resting energy by the member’s self-reported total-activity category and displays a maintenance range around the resulting estimate rather than presenting it as a measurement.

Goal targets remain conservative:

- Gentle deficit: 10% below estimated maintenance.
- Moderate deficit: 15% below estimated maintenance, capped at 500 kcal per day.
- Gentle surplus: about 5% above estimated maintenance.
- Moderate surplus: about 7.5% above estimated maintenance, bounded to 100–250 kcal per day.
- No generated day can fall below 1,200 kcal. A deficit is not generated when current BMI is below 18.5, when the reviewed calorie floor cannot be maintained, or when a displayed 4-, 8-, or 12-week lower scenario would cross that BMI boundary.

Steady, training-day zigzag, and flexible-day schedules redistribute the same seven-day calorie budget. If a requested variation would cross the calorie floor, STRATA falls back to a steady schedule and explains why. “Flexible day” is used instead of moral language such as “cheat day.”

Optional macro targets keep protein within 1.6–2.0 g/kg and no more than 30% of energy, set fat near 25% of energy, and assign remaining energy to carbohydrate. The exercise-protein range follows the [International Society of Sports Nutrition position stand](https://pubmed.ncbi.nlm.nih.gov/28642676/); the results remain planning targets, not clinical prescriptions.

## Remaining-day food options

The daily intake log can turn the unconsumed portion of that day's calorie target—and, when enabled, protein, carbohydrate, and fat targets—into up to three meal-menu options. The planner uses the member's saved dietary pattern, dietary requirements, supported allergen selections, favorite-food categories, preferred 1–6 meals per day, and optional daily food budget. Meal count is a scheduling preference, not a claim that one eating frequency is healthier than another.

The server derives these options when the member requests them; it does not treat a suggestion as food eaten and does not add it to the daily intake log. It subtracts the saved intake values from that day's generated target, estimates one to the preferred daily meal count from the fraction of calories still remaining, divides the balance across those remaining meals, and bounds each catalog portion from 0.25 to 3.5 servings. This is a presentation heuristic, not an inference about meals already eaten. When macro targets are enabled and all three consumed macros are entered, ranking considers the remaining macro proportions as well as calories. If a calorie entry omits those optional macros, STRATA switches that request to calorie-only matching rather than inventing a macro remainder.

A menu receives `ready` status only when three distinct alternatives pass every hard filter and each is within the greater of 100 kcal or 10% of the remaining calorie target. A result outside that tolerance is labeled `limited`, keeps its actual difference visible, and asks the member to review portions manually rather than presenting a close match.

Constraints have a deliberate order:

1. Saved supported allergens, dietary pattern, and gluten-free or dairy-free requirements filter the catalog before any ranking occurs.
2. If an allergy is outside the supported tags or the member is unsure, STRATA withholds automatic options and asks for manual review; it does not guess from free text.
3. Favorite-food matches and the optional USD budget affect ordering only. They never reintroduce a meal removed by an allergy or dietary rule.
4. If no meal passes every hard filter, the result explains that no compatible catalog option was found rather than weakening a constraint.

STRATA's supported allergen checklist follows the US Food and Drug Administration's nine major food-allergen categories: milk, egg, fish, crustacean shellfish, tree nuts, peanuts, wheat, soy, and sesame. That list is not exhaustive, and an ingredient match cannot establish that a packaged product, kitchen, or serving is free from cross-contact. Members must still inspect current labels and preparation conditions. See the FDA's [food-allergy overview](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies) and [consumer label guidance](https://www.fda.gov/consumers/consumer-updates/have-food-allergies-read-label).

The bundled meal catalog uses approximate household ingredient amounts and rounded STRATA editorial recipe estimates informed by generic values in [USDA FoodData Central](https://fdc.nal.usda.gov/). FoodData Central is the reference source, not a live lookup, item-by-item audit trail, or guarantee about a branded product. The listed amounts define one base meal; the displayed multiplier scales that combination. Actual measurement, preparation, substitutions, and manufacturer formulations can change calories and macros. The catalog fingerprint returned with a result makes the exact bundled catalog revision reviewable and keeps same-input suggestions deterministic.

Costs are rough US-dollar ingredient estimates, not current local prices. The daily budget creates a visible comparison and a ranking penalty for options that exceed it; it is not a hard promise that a menu can be purchased for that amount. The daily intake log does not collect actual spending, so the comparison uses the complete entered daily budget rather than pretending to know what has already been spent. Brand, store, country, tax, season, package size, delivery, leftovers, and waste can change actual cost. The planner follows general budget principles such as comparing unit prices, using durable staples, and planning leftovers from the USDA MyPlate guidance on [eating healthy on a budget](https://www.myplate.gov/sites/default/files/2024-06/TipSheet-23-Eat-Healthy-On-A-Budget.pdf) and [budget-friendly weekly meals](https://www.myplate.gov/eathealthy/budget/budget-weekly-meals), but it does not receive live grocery inventory or pricing.

## Weight scenarios

The 4-, 8-, and 12-week values use a deliberately simplified dynamic-response approximation inspired by the research behind the [NIDDK Body Weight Planner](https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner) and [Hall and colleagues’ dynamic model](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/). STRATA does not claim to reproduce the full NIDDK model. Values are rounded, shown with broad scenario bands, and described as trends rather than promises. Hydration, glycogen, digestion, adherence, medication, health status, muscle gain, and individual metabolism can materially change scale weight.

## Weekly training generation

The weekly plan is deterministic. Its key combines the coaching-profile revision, Monday date, exercise-catalog fingerprint, and generator version. It remains stable within a week, then rotates on the next Monday in the member’s saved time zone. A profile edit creates a new current-week plan immediately.

Exercise selection uses the member’s training days, session duration, experience, equipment, saved movement limitations, and entered exercise capabilities. A capability is context—not a verified one-repetition maximum. If no complete session can satisfy the constraints, STRATA asks the member to review them instead of silently choosing an excluded movement.

Plans progress repetitions before load. Once every set reaches the top of its repetition range with controlled form on two comparable sessions, the workspace suggests a small load increase. This follows the progression principles in the [American College of Sports Medicine position stand](https://pubmed.ncbi.nlm.nih.gov/19204579/). The workspace also explains that general US guidance recommends muscle-strengthening work on at least two days per week while still allowing a one-day starting plan; the [Physical Activity Guidelines for Americans](https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines) emphasize gradual progression for inactive adults.

## Safety and privacy boundaries

- Adults ages 18–80 only.
- Not designed for pregnancy, eating-disorder treatment, minors, medical nutrition therapy, or injury-specific programming.
- Pain is a reason to stop or modify a movement and seek qualified care, not a signal to train through it.
- Meal options are planning ideas, not prescriptions, allergy certification, therapeutic diets, verified nutrition measurements, or purchase-price guarantees.
- Height, weight, body-fat input, exercise capabilities, saved dietary pattern, allergies and uncertainty note, dietary requirements, favorite-food categories, meal count, budget, generated weeks, and intake logs are private account data. The canonical profile is also embedded in the private current-week snapshot so its generation inputs remain reviewable. Coaching APIs require an authenticated, currently entitled Strata+ session. Mutations require same-origin and CSRF validation. Account deletion removes coaching data through database cascades, and account export includes the profile and weekly snapshot with the member’s other private records.
