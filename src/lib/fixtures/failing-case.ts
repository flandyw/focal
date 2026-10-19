import { MISTAKE_CATEGORIES, type ExamAttempt, type Mistake } from "../exam-data"

/**
 * Modelled on the account that exposed the problem: 53 Methods papers, none with question results,
 * 102 mistake cards spread over 82 distinct free-text area labels, and some papers logged with the
 * wrong total (Exam 1 out of 80, Exam 2 out of 40). Synthetic and deterministic; not real student data.
 */
export const FAILING_CASE_SUBJECT = "Mathematical Methods"

/** [free-text label, topic a person would file it under]. `null` = nothing in the label says. */
export const FAILING_CASE_LABELS: ReadonlyArray<readonly [string, string | null]> = [
  ["Domain and range of hybrid functions", "Functions/domains/transformations"],
  ["Transformations of y = log(x)", "Functions/domains/transformations"],
  ["Dilations and reflections of a cubic", "Functions/domains/transformations"],
  ["Polynomial factorisation and solving", "Functions/domains/transformations"],
  ["Exponential and logarithm equations", "Functions/domains/transformations"],
  ["Composite functions and their domains", "Functions/domains/transformations"],
  ["Sketching a graph with asymptotes", "Functions/domains/transformations"],
  ["Piecewise function continuity", "Functions/domains/transformations"],
  ["Functions and graphs", "Functions/domains/transformations"],
  ["Index laws and surds", "Functions/domains/transformations"],
  ["Absolute value equations", "Functions/domains/transformations"],
  ["Inverse functions and domain restriction", "Inverse functions & intersections"],
  ["Finding the inverse of a hybrid function", "Inverse functions & intersections"],
  ["Intersection of f and its inverse", "Inverse functions & intersections"],
  ["Points of intersection of two curves", "Inverse functions & intersections"],
  ["f^-1(x) for a log function", "Inverse functions & intersections"],
  ["One-to-one functions", "Inverse functions & intersections"],
  ["Self-inverse functions", "Inverse functions & intersections"],
  ["Inverse of a cubic with restricted domain", "Inverse functions & intersections"],
  ["Solve f(x) = f^-1(x)", "Inverse functions & intersections"],
  ["Where the graph meets its inverse", "Inverse functions & intersections"],
  ["Derivative of a product", "Differentiation & applications"],
  ["Chain rule with exponentials", "Differentiation & applications"],
  ["Stationary points and nature", "Differentiation & applications"],
  ["Optimisation of a box volume", "Differentiation & applications"],
  ["Tangent to a curve at a point", "Differentiation & applications"],
  ["Normal to a curve", "Differentiation & applications"],
  ["Rates of change in context", "Differentiation & applications"],
  ["Quotient rule and gradient", "Differentiation & applications"],
  ["Local maximum and minimum", "Differentiation & applications"],
  ["Differentiation of log functions", "Differentiation & applications"],
  ["Gradient of a secant and tangent", "Differentiation & applications"],
  ["Maximum profit problem", "Differentiation & applications"],
  ["Turning points of a quartic", "Differentiation & applications"],
  ["Antiderivative of an exponential", "Integration & area"],
  ["Definite integral with substitution", "Integration & area"],
  ["Area between curves", "Integration & area"],
  ["Area under a curve with technology", "Integration & area"],
  ["Fundamental theorem of calculus", "Integration & area"],
  ["Average value of a function", "Integration & area"],
  ["Trapezium rule estimates", "Integration & area"],
  ["Integrating a trigonometric function", "Integration & area"],
  ["Area enclosed by two functions", "Integration & area"],
  ["Integral of a rational function", "Integration & area"],
  ["Signed area and net change", "Integration & area"],
  ["Integration by recognition", "Integration & area"],
  ["Binomial probability with technology", "Probability (discrete, conditional, binomial)"],
  ["Conditional probability tree diagram", "Probability (discrete, conditional, binomial)"],
  ["Discrete random variable table", "Probability (discrete, conditional, binomial)"],
  ["Pr(X >= 3) for a binomial", "Probability (discrete, conditional, binomial)"],
  ["Bernoulli trials", "Probability (discrete, conditional, binomial)"],
  ["Independent events", "Probability (discrete, conditional, binomial)"],
  ["Hypergeometric style counting", "Probability (discrete, conditional, binomial)"],
  ["Venn diagram probability", "Probability (discrete, conditional, binomial)"],
  ["Expected value of a discrete distribution", "Probability (discrete, conditional, binomial)"],
  ["Conditional binomial", "Probability (discrete, conditional, binomial)"],
  ["Probability of at least one success", "Probability (discrete, conditional, binomial)"],
  ["Normal distribution z-scores", "Continuous distributions, normal, sampling & CIs"],
  ["Inverse normal for a cut-off", "Continuous distributions, normal, sampling & CIs"],
  ["Probability density function validity", "Continuous distributions, normal, sampling & CIs"],
  ["Cumulative distribution and median", "Continuous distributions, normal, sampling & CIs"],
  ["Confidence interval for a proportion", "Continuous distributions, normal, sampling & CIs"],
  ["Sample proportion distribution", "Continuous distributions, normal, sampling & CIs"],
  ["Margin of error", "Continuous distributions, normal, sampling & CIs"],
  ["Standard deviation of a continuous variable", "Continuous distributions, normal, sampling & CIs"],
  ["Standard normal tables", "Continuous distributions, normal, sampling & CIs"],
  ["Quantiles of a pdf", "Continuous distributions, normal, sampling & CIs"],
  ["Sampling and approximate CIs", "Continuous distributions, normal, sampling & CIs"],
  ["Solving trigonometric equations", "Circular functions"],
  ["Amplitude and period of a sine graph", "Circular functions"],
  ["Radians and exact values", "Circular functions"],
  ["Transformations of cosine", "Circular functions"],
  ["Tan graph asymptotes and period", "Circular functions"],
  ["Circular function modelling tides", "Circular functions"],
  ["Sinusoidal model fitting", "Circular functions"],
  ["Unit circle exact values", "Circular functions"],
  ["Calculus – tangent equations and area between curves", "Differentiation & applications"],
  ["Inverse functions and integration", "Inverse functions & intersections"],
  ["Exam technique", null],
  ["Reading the question carefully", null],
  ["Careless errors", null],
  ["Setting out working", null],
  ["Time management", null],
]

const CARDS = 102
const ATTEMPTS = 53

export function failingCase() {
  const attempts: ExamAttempt[] = Array.from({ length: ATTEMPTS }, (_, index) => {
    const exam1 = index % 2 === 0
    const swapped = index % 9 === 0 // Exam 1 logged out of 80 / Exam 2 out of 40
    const rawMax = exam1 !== swapped ? 40 : 80
    return {
      id: `attempt-${index}`, subject: FAILING_CASE_SUBJECT, provider: ["VCAA", "Neap", "Insight", "Kilbaha"][index % 4], examYear: 2015 + (index % 10),
      title: `Paper ${index}`, paper: exam1 ? "Exam 1" : "Exam 2", completedAt: `2026-${String(1 + (index % 9)).padStart(2, "0")}-${String(1 + (index % 27)).padStart(2, "0")}`,
      rawScore: Math.round(rawMax * 0.7), rawMax, referenceId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }
  })
  const mistakes: Mistake[] = Array.from({ length: CARDS }, (_, index) => {
    const [label] = FAILING_CASE_LABELS[index % FAILING_CASE_LABELS.length]
    const totalMarks = 2 + (index % 4)
    return {
      id: `card-${index}`, attemptId: `attempt-${(index * 7) % ATTEMPTS}`, question: `Q${1 + (index % 12)}`, questionText: "x".repeat(300),
      category: MISTAKE_CATEGORIES[index % MISTAKE_CATEGORIES.length], explanation: "Slipped.", correction: "<svg>" + "m".repeat(400) + "</svg>",
      totalMarks, marksLost: 1 + (index % Math.min(3, totalMarks)), areaOfStudy: label, resolved: false,
      createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z",
    }
  })
  return { attempts, mistakes }
}
