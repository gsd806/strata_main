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
- Height, weight, body-fat input, exercise capabilities, generated weeks, and intake logs are private account data. Coaching APIs require an authenticated, currently entitled Strata+ session. Mutations require same-origin and CSRF validation. Account deletion removes coaching data through database cascades, and account export includes it with the member’s other private records.
