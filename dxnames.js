/*
 * Admissions Tracker — diagnosis names to ICD-10-CM codes.
 * A curated list of common skilled-nursing diagnoses and abbreviations, with
 * laterality and negation handling. Every code is checked against the bundled
 * CMS ICD-10-CM list before it is offered, and every match is shown as
 * "suggested — verify". Runs entirely on this device.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AdmissionsDxNames = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LOWER = "(?:leg|legs|lower\\s+(?:extremity|extremities|limb|limbs|leg)|le|lle|rle|bles?|thigh|knee|calf|shin|ankle|foot|feet|heel)";
  const UPPER = "(?:arm|arms|upper\\s+(?:extremity|extremities|limb|limbs|arm)|ue|lue|rue|forearm|elbow|hand|wrist|shoulder)";

  // side: {left, right, bilateral, none}. Rules are tried in order; the first
  // rule that matches a phrase wins, so specific rules come first.
  const RULES = [
    // Cellulitis
    { re: new RegExp("cellulitis\\b[^.;\\n]{0,40}?\\b" + LOWER + "\\b|\\b" + LOWER + "\\b[^.;\\n]{0,25}?cellulitis", "i"), side: { right: "L03.115", left: "L03.116", bilateral: ["L03.116", "L03.115"], none: "L03.119" }, alts: ["L03.90"], name: "cellulitis of lower limb" },
    { re: new RegExp("cellulitis\\b[^.;\\n]{0,40}?\\b" + UPPER + "\\b|\\b" + UPPER + "\\b[^.;\\n]{0,25}?cellulitis", "i"), side: { right: "L03.113", left: "L03.114", bilateral: ["L03.114", "L03.113"], none: "L03.119" }, alts: ["L03.90"], name: "cellulitis of upper limb" },
    { re: /cellulitis\b[^.;\n]{0,30}?\b(?:face|facial|cheek)\b/i, code: "L03.211", alts: ["L03.90"] },
    { re: /cellulitis\b[^.;\n]{0,30}?\b(?:abdominal\s+wall|abdomen)\b/i, code: "L03.311", alts: ["L03.90"] },
    { re: /cellulitis\b[^.;\n]{0,30}?\b(?:buttock|gluteal)\b/i, code: "L03.317", alts: ["L03.90"] },
    { re: /\bcellulitis\b/i, code: "L03.90", alts: ["L03.119"] },
    // Heart failure
    { re: /acute\s+on\s+chronic\s+(?:systolic|hfref|heart\s+failure\s+with\s+reduced)[^.;\n]{0,30}|acute\s+on\s+chronic\s+(?:hf|chf|heart\s+failure)\s*(?:with\s+reduced|hfref|systolic)/i, code: "I50.23", alts: ["I50.9", "I50.20"] },
    { re: /acute\s+on\s+chronic\s+(?:diastolic|hfpef|heart\s+failure\s+with\s+preserved)|acute\s+on\s+chronic\s+(?:hf|chf|heart\s+failure)\s*(?:with\s+preserved|hfpef|diastolic)/i, code: "I50.33", alts: ["I50.9", "I50.30"] },
    { re: /acute\s+on\s+chronic\s+combined/i, code: "I50.43", alts: ["I50.9"] },
    { re: /chronic\s+(?:systolic|hfref)/i, code: "I50.22", alts: ["I50.20", "I50.9"] },
    { re: /chronic\s+(?:diastolic|hfpef)/i, code: "I50.32", alts: ["I50.30", "I50.9"] },
    { re: /acute\s+(?:systolic|hfref)/i, code: "I50.21", alts: ["I50.20", "I50.9"] },
    { re: /acute\s+(?:diastolic|hfpef)/i, code: "I50.31", alts: ["I50.30", "I50.9"] },
    { re: /\b(?:systolic\s+(?:heart\s+failure|hf|chf|dysfunction)|hfref|heart\s+failure\s+with\s+reduced)/i, code: "I50.20", alts: ["I50.9"] },
    { re: /\b(?:diastolic\s+(?:heart\s+failure|hf|chf|dysfunction)|hfpef|heart\s+failure\s+with\s+preserved)/i, code: "I50.30", alts: ["I50.9"] },
    { re: /\b(?:chf|congestive\s+heart\s+failure|heart\s+failure|hf)\b/i, code: "I50.9", alts: ["I50.20", "I50.30", "I11.0"] },
    // COPD and respiratory
    { re: /\b(?:aecopd|copd\s*(?:with\s+)?(?:acute\s+)?exacerbation|exacerbation\s+of\s+copd|copd\s+exac\w*|chronic\s+obstructive\s+pulmonary\s+disease\s+with\s+(?:acute\s+)?exacerbation)\b/i, code: "J44.1", alts: ["J44.9", "J44.0"] },
    { re: /\b(?:copd|chronic\s+obstructive\s+pulmonary\s+disease|chronic\s+obstructive\s+lung\s+disease|emphysema)\b/i, code: "J44.9", alts: ["J44.1", "J43.9"] },
    { re: /acute\s+on\s+chronic\s+(?:hypoxic\s+|hypoxemic\s+)?respiratory\s+failure/i, code: "J96.21", alts: ["J96.20"] },
    { re: /acute\s+(?:hypoxic|hypoxemic)\s+respiratory\s+failure|acute\s+respiratory\s+failure\s+with\s+hypoxia/i, code: "J96.01", alts: ["J96.00"] },
    { re: /chronic\s+(?:hypoxic\s+|hypoxemic\s+)?respiratory\s+failure/i, code: "J96.11", alts: ["J96.10"] },
    { re: /acute\s+respiratory\s+failure/i, code: "J96.00", alts: ["J96.01"] },
    { re: /\brespiratory\s+failure\b/i, code: "J96.90", alts: ["J96.01"] },
    { re: /\baspiration\s+pneumonia\b|\bpneumonitis\s+due\s+to\s+inhalation/i, code: "J69.0", alts: ["J18.9"] },
    { re: /\b(?:covid(?:-?19)?|sars-?cov-?2)\s+pneumonia\b/i, code: "U07.1", alts: ["J12.82"] },
    { re: /\b(?:pneumonia|pna|cap|hcap|community[- ]acquired\s+pneumonia)\b/i, code: "J18.9", alts: ["J69.0", "J15.9"] },
    { re: /\b(?:covid(?:-?19)?|sars-?cov-?2\s+infection)\b/i, code: "U07.1" },
    { re: /\b(?:osa|obstructive\s+sleep\s+apnea)\b/i, code: "G47.33" },
    { re: /\bpulmonary\s+embol(?:ism|us)\b|\bPE\b(?=\s*(?:$|[,;(]|\s+(?:on|with|-)))/, code: "I26.99", alts: ["I26.09"] },
    // Infections
    { re: /\bsevere\s+sepsis\s+with\s+septic\s+shock|\bseptic\s+shock\b/i, code: "R65.21", alts: ["A41.9"] },
    { re: /\bsepsis\b[^.;\n]{0,25}\bmrsa\b/i, code: "A41.02", alts: ["A41.9"] },
    { re: /\bsevere\s+sepsis\b/i, code: "R65.20", alts: ["A41.9"] },
    { re: /\b(?:sepsis|urosepsis|septicemia)\b/i, code: "A41.9", alts: ["R65.20"] },
    { re: /\bcauti\b|catheter[- ]associated\s+(?:uti|urinary\s+tract\s+infection)/i, code: "T83.511A", alts: ["N39.0"] },
    { re: /\bpyelonephritis\b/i, code: "N10", alts: ["N39.0"] },
    { re: /\b(?:uti|urinary\s+tract\s+infection)\b/i, code: "N39.0" },
    { re: /\bc\.?\s?diff(?:icile)?\b(?:\s+(?:colitis|infection|enterocolitis))?/i, code: "A04.72", alts: ["A04.71"] },
    { re: /\bosteomyelitis\b/i, code: "M86.9" },
    // Stroke
    { re: /\b(?:hemiplegia|hemiparesis)\b[^.;\n]{0,50}\b(?:cva|stroke|cerebral\s+infarct\w*)\b|\b(?:cva|stroke)\b[^.;\n]{0,40}\b(?:hemiplegia|hemiparesis)\b/i, side: { right: "I69.351", left: "I69.354", bilateral: "I69.359", none: "I69.359" }, alts: ["I69.359", "I63.9"] },
    { re: /\b(?:hemorrhagic\s+stroke|intracerebral\s+hemorrhage|ich)\b/i, code: "I61.9" },
    { re: /\b(?:personal\s+)?(?:history\s+of|hx\s+of|h\/o)\s+(?:cva|stroke|cerebral\s+infarct\w*)\b/i, code: "Z86.73", alts: ["I69.30"] },
    { re: /\b(?:acute\s+)?(?:ischemic\s+)?(?:cva|stroke|cerebrovascular\s+accident|cerebral\s+infarct(?:ion)?)\b/i, code: "I63.9", alts: ["I69.30", "Z86.73"] },
    { re: /\b(?:tia|transient\s+ischemic\s+attack)\b/i, code: "G45.9" },
    // Fractures and orthopedics
    { re: /\bintertrochanteric\s+(?:hip\s+|femur\s+|femoral\s+)?(?:fx|fracture)\b/i, side: { right: "S72.141A", left: "S72.142A", bilateral: ["S72.142A", "S72.141A"], none: "S72.143A" }, alts: ["S72.009A"] },
    { re: /\b(?:hip\s+(?:fx|fracture)|fracture\s+of\s+(?:the\s+)?(?:\w+\s+)?hip|(?:femoral|femur)\s+neck\s+(?:fx|fracture)|fx\s+(?:of\s+)?(?:\w+\s+)?hip)\b/i, side: { right: "S72.001A", left: "S72.002A", bilateral: ["S72.002A", "S72.001A"], none: "S72.009A" }, alts: ["S72.90XA", "Z47.89"] },
    { re: /\b(?:femur|femoral)\s+(?:shaft\s+)?(?:fx|fracture)\b/i, side: { right: "S72.91XA", left: "S72.92XA", none: "S72.90XA" }, alts: ["S72.90XA"] },
    { re: /\b(?:tka|total\s+knee\s+(?:arthroplasty|replacement)|knee\s+replacement)\b/i, side: { right: "Z96.651", left: "Z96.652", bilateral: "Z96.653", none: "Z96.659" }, alts: ["Z47.1"] },
    { re: /\b(?:tha|total\s+hip\s+(?:arthroplasty|replacement)|hip\s+replacement)\b/i, side: { right: "Z96.641", left: "Z96.642", bilateral: "Z96.643", none: "Z96.649" }, alts: ["Z47.1"] },
    { re: /\b(?:bka|below[- ]the[- ]knee\s+amputation|below[- ]knee\s+amputation)\b/i, side: { right: "Z89.511", left: "Z89.512", bilateral: ["Z89.512", "Z89.511"], none: "Z89.519" } },
    { re: /\b(?:aka|above[- ]the[- ]knee\s+amputation|above[- ]knee\s+amputation)\b/i, side: { right: "Z89.611", left: "Z89.612", bilateral: ["Z89.612", "Z89.611"], none: "Z89.619" } },
    { re: /\b(?:osteoarthritis|oa|djd|degenerative\s+joint\s+disease)\b[^.;\n]{0,20}\bknees?\b|\bknee\s+(?:osteoarthritis|oa)\b/i, side: { right: "M17.11", left: "M17.12", bilateral: "M17.0", none: "M17.10" }, alts: ["M19.90"] },
    { re: /\b(?:osteoarthritis|degenerative\s+joint\s+disease|djd)\b/i, code: "M19.90" },
    { re: /\bosteoporosis\b/i, code: "M81.0" },
    // Metabolic and endocrine
    { re: /\b(?:type\s*(?:1|i)\s*(?:dm|diabetes)|t1dm|iddm|dm\s*(?:1|i)\b|diabetes\s+mellitus\s+type\s*(?:1|i))\b/i, code: "E10.9", alts: ["E10.65"] },
    { re: /\bdiabet\w*\s+foot\s+ulcer|\bdfu\b/i, code: "E11.621", alts: ["E11.9"] },
    { re: /\b(?:dm|diabetes|t2dm|dm2)\b[^.;\n]{0,40}\bneuropathy\b|\bdiabetic\s+(?:peripheral\s+)?neuropathy\b/i, code: "E11.40", alts: ["E11.42", "E11.9"] },
    { re: /\b(?:dm|diabetes|t2dm|dm2)\b[^.;\n]{0,40}\b(?:hyperglycemia|uncontrolled|poorly\s+controlled)\b|\b(?:uncontrolled|poorly\s+controlled)\s+(?:dm|diabetes|t2dm)/i, code: "E11.65", alts: ["E11.9"] },
    { re: /\b(?:type\s*(?:2|ii)\s*(?:dm|diabetes)|t2dm|niddm|dm\s*(?:2|ii)\b|diabetes\s+mellitus\s+type\s*(?:2|ii)|diabetes(?:\s+mellitus)?|dm)\b/i, code: "E11.9", alts: ["E11.65", "Z79.4"] },
    { re: /\b(?:morbid|severe)\s+obesity\b/i, code: "E66.01", alts: ["E66.9"] },
    { re: /\bobesity\b/i, code: "E66.9" },
    { re: /\bhypothyroidism\b/i, code: "E03.9" },
    { re: /\b(?:hyperlipidemia|hld|dyslipidemia|high\s+cholesterol|hypercholesterolemia)\b/i, code: "E78.5" },
    { re: /\bhyponatremia\b/i, code: "E87.1" },
    { re: /\bhypokalemia\b/i, code: "E87.6" },
    { re: /\bdehydration\b/i, code: "E86.0" },
    { re: /\bsevere\s+(?:protein[- ]calorie\s+)?malnutrition\b/i, code: "E43", alts: ["E46"] },
    { re: /\b(?:protein[- ]calorie\s+)?malnutrition\b/i, code: "E46", alts: ["E44.0"] },
    // Cardiovascular
    { re: /\b(?:htn|hypertension)\s+(?:with|and|w\/)\s+(?:ckd|chronic\s+kidney)\b|\bhypertensive\s+(?:chronic\s+)?kidney\s+disease\b/i, code: "I12.9", alts: ["I10"] },
    { re: /\bpulmonary\s+hypertension\b/i, code: "I27.20" },
    { re: /\b(?:htn|hypertension|high\s+blood\s+pressure|essential\s+hypertension)\b/i, code: "I10" },
    { re: /\bparoxysmal\s+(?:a-?fib|afib|atrial\s+fibrillation)\b/i, code: "I48.0", alts: ["I48.91"] },
    { re: /\bpersistent\s+(?:a-?fib|afib|atrial\s+fibrillation)\b/i, code: "I48.19", alts: ["I48.91"] },
    { re: /\b(?:permanent|chronic)\s+(?:a-?fib|afib|atrial\s+fibrillation)\b/i, code: "I48.21", alts: ["I48.20", "I48.91"] },
    { re: /\b(?:a-?fib|afib|a\.\s?fib|atrial\s+fibrillation)\b/i, code: "I48.91", alts: ["I48.0", "I48.20"] },
    { re: /\batrial\s+flutter\b/i, code: "I48.92" },
    { re: /\b(?:cad|coronary\s+artery\s+disease|ashd|atherosclerotic\s+heart\s+disease)\b/i, code: "I25.10" },
    { re: /\b(?:dvt|deep\s+vein\s+thrombosis)\b/i, side: { right: "I82.401", left: "I82.402", bilateral: "I82.403", none: "I82.409" } },
    { re: /\b(?:pvd|pad|peripheral\s+(?:vascular|arterial)\s+disease)\b/i, code: "I73.9" },
    // Kidney and urinary
    { re: /\b(?:esrd|end[- ]stage\s+renal\s+disease)\b/i, code: "N18.6", alts: ["Z99.2"] },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)?(?:3a|iiia)\b/i, code: "N18.31" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)?(?:3b|iiib)\b/i, code: "N18.32" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)(?:3|iii)\b/i, code: "N18.30" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)(?:4|iv)\b/i, code: "N18.4" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)(?:5|v)\b/i, code: "N18.5" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease)\s*(?:,\s*)?(?:stage\s*|stg\s*)(?:2|ii)\b/i, code: "N18.2" },
    { re: /\b(?:ckd|chronic\s+kidney\s+disease|chronic\s+renal\s+(?:failure|insufficiency))\b/i, code: "N18.9", alts: ["N18.30"] },
    { re: /\b(?:aki|acute\s+kidney\s+injury|acute\s+renal\s+failure|acute\s+kidney\s+failure)\b/i, code: "N17.9" },
    { re: /\b(?:bph|benign\s+prostatic\s+hyperplasia)\b/i, code: "N40.0" },
    { re: /\burinary\s+retention\b/i, code: "R33.9" },
    // Neuro and mental health
    { re: /\balzheimer'?s?\b/i, code: "G30.9", alts: ["F02.80"] },
    { re: /\bvascular\s+dementia\b/i, code: "F01.50" },
    { re: /\blewy\s+body\b/i, code: "G31.83" },
    { re: /\bdementia\b/i, code: "F03.90", alts: ["F03.91", "G30.9"] },
    { re: /\bparkinson'?s?(?:\s+disease)?\b/i, code: "G20.A1", alts: ["G20.C"] },
    { re: /\bmetabolic\s+encephalopathy\b/i, code: "G93.41", alts: ["G93.40"] },
    { re: /\bencephalopathy\b/i, code: "G93.40" },
    { re: /\b(?:altered\s+mental\s+status|ams)\b/i, code: "R41.82" },
    { re: /\b(?:seizure\s+disorder|epilepsy)\b/i, code: "G40.909", alts: ["R56.9"] },
    { re: /\bseizures?\b/i, code: "R56.9" },
    { re: /\b(?:major\s+depressive\s+disorder|mdd)\b/i, code: "F32.9", alts: ["F32.A"] },
    { re: /\bdepression\b/i, code: "F32.A", alts: ["F32.9"] },
    { re: /\banxiety\b/i, code: "F41.9" },
    // Skin and wounds
    { re: /\b(?:pressure\s+(?:ulcer|injury|wound)|decubitus(?:\s+ulcer)?|bed\s*sore)\b[^.;\n]{0,40}\b(?:sacr\w*|coccyx)\b[^.;\n]{0,20}\bstage\s*(?:4|iv)\b|\b(?:sacr\w*|coccyx)\b[^.;\n]{0,30}\bstage\s*(?:4|iv)\b/i, code: "L89.154", alts: ["L89.150"] },
    { re: /\b(?:pressure\s+(?:ulcer|injury|wound)|decubitus(?:\s+ulcer)?|bed\s*sore)\b[^.;\n]{0,40}\b(?:sacr\w*|coccyx)\b[^.;\n]{0,20}\bstage\s*(?:3|iii)\b|\b(?:sacr\w*|coccyx)\b[^.;\n]{0,30}\bstage\s*(?:3|iii)\b/i, code: "L89.153", alts: ["L89.150"] },
    { re: /\b(?:pressure\s+(?:ulcer|injury|wound)|decubitus(?:\s+ulcer)?|bed\s*sore)\b[^.;\n]{0,40}\b(?:sacr\w*|coccyx)\b[^.;\n]{0,20}\bstage\s*(?:2|ii)\b|\b(?:sacr\w*|coccyx)\b[^.;\n]{0,30}\bstage\s*(?:2|ii)\b/i, code: "L89.152", alts: ["L89.150"] },
    { re: /\b(?:pressure\s+(?:ulcer|injury|wound)|decubitus(?:\s+ulcer)?|bed\s*sore)\b[^.;\n]{0,40}\b(?:sacr\w*|coccyx)\b/i, code: "L89.159", alts: ["L89.150"] },
    { re: /\b(?:pressure\s+(?:ulcer|injury)|decubitus(?:\s+ulcer)?|bed\s*sore)\b/i, code: "L89.90" },
    // General and function
    { re: /\bdysphagia\b[^.;\n]{0,20}\boropharyngeal\b|\boropharyngeal\s+dysphagia\b/i, code: "R13.12", alts: ["R13.10"] },
    { re: /\bdysphagia\b/i, code: "R13.10", alts: ["R13.12"] },
    { re: /\b(?:adult\s+)?failure\s+to\s+thrive\b|\bftt\b/i, code: "R62.7" },
    { re: /\b(?:debility|deconditioning|deconditioned|physical\s+deconditioning)\b/i, code: "R53.81", alts: ["M62.81"] },
    { re: /\b(?:generalized\s+(?:muscle\s+)?weakness|muscle\s+weakness)\b/i, code: "M62.81", alts: ["R53.1"] },
    { re: /\b(?:frequent\s+falls|recurrent\s+falls|history\s+of\s+falls?|hx\s+of\s+falls?|at\s+risk\s+for\s+falls|repeated\s+falls)\b/i, code: "Z91.81" },
    { re: /\b(?:difficulty\s+(?:in\s+)?walking|gait\s+(?:instability|abnormality|disturbance)|unsteady\s+gait)\b/i, code: "R26.89", alts: ["R26.2", "R26.81"] },
    { re: /\banemia\b/i, code: "D64.9", alts: ["D50.9", "D63.1"] },
    { re: /\b(?:gerd|gastro-?esophageal\s+reflux(?:\s+disease)?|acid\s+reflux)\b/i, code: "K21.9" },
    { re: /\bconstipation\b/i, code: "K59.00" },
  ];

  // Plain names (longest match wins), each [pattern, code, alternatives].
  const SIMPLE = [
    ["iron deficiency anemia|ida", "D50.9", ["D64.9"]],
    ["anemia of chronic kidney disease|anemia (?:of|due to|in) ckd", "D63.1", ["D64.9"]],
    ["anemia of chronic disease", "D63.8", ["D64.9"]],
    ["acute blood loss anemia|abla", "D62", ["D64.9"]],
    ["vitamin b12 deficiency|b12 deficiency", "E53.8", ["D51.9"]],
    ["thrombocytopenia", "D69.6", []],
    ["leukocytosis", "D72.829", []],
    ["neutropenia", "D70.9", []],
    ["pancytopenia", "D61.818", []],
    ["coagulopathy", "D68.9", []],
    ["hypercoagulable state", "D68.59", []],
    ["hyperkalemia", "E87.5", []],
    ["hypernatremia", "E87.0", []],
    ["hypomagnesemia", "E83.42", []],
    ["hypophosphatemia", "E83.39", []],
    ["hypocalcemia", "E83.51", []],
    ["hypercalcemia", "E83.52", []],
    ["hypoglycemia", "E16.2", []],
    ["hyperglycemia", "R73.9", []],
    ["diabetic ketoacidosis|dka", "E11.10", ["E10.10"]],
    ["hyperthyroidism", "E05.90", []],
    ["vitamin d deficiency", "E55.9", []],
    ["gout", "M10.9", []],
    ["metabolic acidosis", "E87.20", ["E87.29"]],
    ["lactic acidosis", "E87.21", ["E87.20"]],
    ["volume overload|fluid overload|hypervolemia", "E87.70", []],
    ["hypovolemia", "E86.1", []],
    ["cachexia", "R64", []],
    ["failure to thrive in adult", "R62.7", []],
    ["unintentional weight loss|abnormal weight loss", "R63.4", []],
    ["morbid obesity", "E66.01", []],
    ["essential tremor", "G25.0", []],
    ["restless legs? syndrome|rls", "G25.81", []],
    ["peripheral neuropathy|polyneuropathy", "G62.9", []],
    ["multiple sclerosis", "G35", []],
    ["myasthenia gravis", "G70.00", []],
    ["als|amyotrophic lateral sclerosis", "G12.21", []],
    ["huntington'?s disease", "G10", []],
    ["spinal stenosis", "M48.00", ["M48.061"]],
    ["lumbar spinal stenosis", "M48.061", ["M48.00"]],
    ["cervical myelopathy", "M47.12", []],
    ["spinal cord injury", "S14.109A", []],
    ["paraplegia", "G82.20", []],
    ["quadriplegia|tetraplegia", "G82.50", []],
    ["cerebral palsy", "G80.9", []],
    ["traumatic brain injury|tbi", "S06.9X0A", []],
    ["subdural hematoma|sdh", "S06.5X0A", ["I62.00"]],
    ["subarachnoid hemorrhage|sah", "I60.9", []],
    ["hydrocephalus", "G91.9", []],
    ["normal pressure hydrocephalus|nph", "G91.2", []],
    ["migraine", "G43.909", []],
    ["delirium", "R41.0", ["F05"]],
    ["cognitive impairment|mild cognitive impairment|mci", "G31.84", ["R41.89"]],
    ["aphasia", "R47.01", []],
    ["dysarthria", "R47.1", []],
    ["facial droop", "R29.810", []],
    ["ataxia", "R27.0", []],
    ["insomnia", "G47.00", []],
    ["schizophrenia", "F20.9", []],
    ["schizoaffective disorder", "F25.9", []],
    ["bipolar disorder", "F31.9", []],
    ["psychosis", "F29", []],
    ["ptsd|post-?traumatic stress disorder", "F43.10", []],
    ["alcohol use disorder|alcohol dependence|etoh abuse|alcohol abuse", "F10.20", ["F10.10"]],
    ["alcohol withdrawal", "F10.239", []],
    ["opioid use disorder|opioid dependence", "F11.20", []],
    ["tobacco use|nicotine dependence|current smoker", "F17.210", ["Z72.0"]],
    ["history of tobacco use|former smoker", "Z87.891", []],
    ["intellectual disability", "F79", []],
    ["autism", "F84.0", []],
    ["adjustment disorder", "F43.20", []],
    ["coronary artery disease s\\/p cabg|history of cabg", "Z95.1", ["I25.10"]],
    ["nstemi|non-?st elevation myocardial infarction", "I21.4", []],
    ["stemi|st elevation myocardial infarction", "I21.3", []],
    ["history of mi|old mi|prior mi", "I25.2", []],
    ["angina", "I20.9", []],
    ["orthostatic hypotension", "I95.1", []],
    ["sick sinus syndrome", "I49.5", []],
    ["supraventricular tachycardia|svt", "I47.10", []],
    ["ventricular tachycardia|v-?tach", "I47.20", []],
    ["heart block|av block", "I44.30", []],
    ["pacemaker|ppm", "Z95.0", []],
    ["aicd|icd in place|defibrillator", "Z95.810", []],
    ["aortic stenosis", "I35.0", []],
    ["mitral regurgitation", "I34.0", []],
    ["cardiomyopathy", "I42.9", []],
    ["ischemic cardiomyopathy", "I25.5", []],
    ["pericardial effusion", "I31.39", []],
    ["endocarditis", "I38", []],
    ["peripheral edema|lower extremity edema|bilateral lower extremity edema", "R60.0", []],
    ["lymphedema", "I89.0", []],
    ["venous insufficiency", "I87.2", []],
    ["varicose veins", "I83.90", []],
    ["abdominal aortic aneurysm|aaa", "I71.40", []],
    ["carotid stenosis|carotid artery stenosis", "I65.29", []],
    ["history of dvt|history of pe", "Z86.718", []],
    ["long term anticoagulation|on anticoagulation|long-term \\(current\\) use of anticoagulants", "Z79.01", []],
    ["long term insulin use|insulin dependent", "Z79.4", []],
    ["asthma", "J45.909", []],
    ["bronchitis", "J40", []],
    ["acute bronchitis", "J20.9", []],
    ["bronchiectasis", "J47.9", []],
    ["pulmonary fibrosis|interstitial lung disease|ild", "J84.10", []],
    ["pleural effusion", "J90", []],
    ["pneumothorax", "J93.9", []],
    ["chronic respiratory failure with hypoxia", "J96.11", []],
    ["dependence on supplemental oxygen|home oxygen|on home o2|chronic o2", "Z99.81", []],
    ["tracheostomy status|trach status", "Z93.0", []],
    ["ventilator dependence|vent dependent", "Z99.11", []],
    ["lung cancer", "C34.90", []],
    ["rsv", "J21.0", ["B97.4"]],
    ["mrsa bacteremia", "A41.02", []],
    ["bacteremia", "R78.81", []],
    ["vre", "Z16.21", []],
    ["esbl", "Z16.12", []],
    ["mrsa carrier|mrsa colonization", "Z22.322", []],
    ["wound infection", "T81.49XA", []],
    ["surgical site infection", "T81.49XA", []],
    ["abscess", "L02.91", []],
    ["gangrene", "I96", []],
    ["necrotizing fasciitis", "M72.6", []],
    ["shingles|herpes zoster", "B02.9", []],
    ["candidiasis|thrush", "B37.9", []],
    ["hepatitis c", "B18.2", []],
    ["hiv", "B20", []],
    ["diverticulitis", "K57.92", []],
    ["diverticulosis", "K57.90", []],
    ["small bowel obstruction|sbo", "K56.609", []],
    ["ileus", "K56.7", []],
    ["gi bleed|gastrointestinal bleed|gastrointestinal hemorrhage", "K92.2", []],
    ["upper gi bleed|ugib", "K92.2", []],
    ["lower gi bleed|lgib", "K92.2", []],
    ["peptic ulcer", "K27.9", []],
    ["pancreatitis", "K85.90", []],
    ["cholecystitis", "K81.9", []],
    ["cirrhosis", "K74.60", []],
    ["hepatic encephalopathy", "K76.82", []],
    ["colitis", "K52.9", []],
    ["ulcerative colitis", "K51.90", []],
    ["crohn'?s disease", "K50.90", []],
    ["irritable bowel syndrome|ibs", "K58.9", []],
    ["fecal incontinence|bowel incontinence", "R15.9", []],
    ["colostomy|colostomy status", "Z93.3", []],
    ["ileostomy", "Z93.2", []],
    ["peg tube|g-?tube|gastrostomy status", "Z93.1", []],
    ["colon cancer", "C18.9", []],
    ["pancreatic cancer", "C25.9", []],
    ["breast cancer", "C50.919", []],
    ["prostate cancer", "C61", []],
    ["bladder cancer", "C67.9", []],
    ["metastatic disease|metastatic cancer", "C79.9", []],
    ["lymphoma", "C85.90", []],
    ["leukemia", "C95.90", []],
    ["multiple myeloma", "C90.00", []],
    ["brain tumor|glioblastoma", "C71.9", []],
    ["neutropenic fever", "D70.9", []],
    ["urinary incontinence", "R32", []],
    ["neurogenic bladder", "N31.9", []],
    ["kidney stone|nephrolithiasis", "N20.0", []],
    ["hydronephrosis", "N13.30", []],
    ["suprapubic catheter", "Z93.59", []],
    ["dialysis dependent|on hemodialysis|hemodialysis|dependence on renal dialysis", "Z99.2", []],
    ["lupus|sle", "M32.9", []],
    ["polymyalgia rheumatica", "M35.3", []],
    ["fibromyalgia", "M79.7", []],
    ["low back pain|lbp", "M54.50", []],
    ["compression fracture", "M48.50XA", []],
    ["vertebral fracture|lumbar fracture", "S32.009A", []],
    ["pelvic fracture|fracture of pelvis", "S32.9XXA", []],
    ["rib fractures?", "S22.39XA", []],
    ["humerus fracture|humeral fracture", "S42.309A", []],
    ["wrist fracture|distal radius fracture", "S52.509A", []],
    ["ankle fracture", "S82.899A", []],
    ["tibia fracture|tibial fracture", "S82.209A", []],
    ["knee fracture|patella fracture", "S82.009A", []],
    ["periprosthetic fracture", "M97.9XXA", []],
    ["spinal fusion|lumbar fusion", "Z98.1", []],
    ["laminectomy", "Z98.890", []],
    ["osteomyelitis of foot", "M86.9", []],
    ["charcot foot", "M14.679", []],
    ["contracture", "M24.50", []],
    ["muscle wasting|sarcopenia", "M62.84", []],
    ["rhabdomyolysis", "M62.82", []],
    ["falls", "Z91.81", []],
    ["impaired mobility|immobility|decreased mobility", "Z74.09", []],
    ["bedbound|bed bound|bedridden", "Z74.01", []],
    ["wheelchair dependent|wheelchair bound", "Z99.3", []],
    ["need for assistance with personal care", "Z74.1", []],
    ["aftercare following joint replacement", "Z47.1", []],
    ["aftercare following surgery", "Z48.89", []],
    ["aftercare for healing traumatic fracture", "Z47.89", []],
    ["diabetic foot infection", "E11.628", []],
    ["diabetic nephropathy", "E11.21", []],
    ["diabetes with ckd|diabetic ckd", "E11.22", []],
    ["diabetic retinopathy", "E11.319", []],
    ["type 2 diabetes with hypoglycemia", "E11.649", []],
    ["prediabetes", "R73.03", []],
    ["obstructive uropathy", "N13.9", []],
    ["skin tear", "S81.809A", []],
    ["venous stasis ulcer|venous ulcer", "I87.2", ["L97.909"]],
    ["arterial ulcer", "L97.909", []],
    ["non-?pressure chronic ulcer|chronic leg ulcer", "L97.909", []],
    ["pressure ulcer of heel|heel pressure injury|heel ulcer", "L89.609", []],
    ["pressure ulcer of buttock|buttock pressure injury", "L89.309", []],
    ["deep tissue injury|dti", "L89.96", ["L89.90"]],
    ["unstageable pressure (?:ulcer|injury)", "L89.90", []],
    ["surgical wound|post-?op wound", "T81.89XA", []],
    ["wound dehiscence", "T81.31XA", []],
    ["psoriasis", "L40.9", []],
    ["dermatitis", "L30.9", []],
    ["glaucoma", "H40.9", []],
    ["macular degeneration", "H35.30", []],
    ["cataract", "H26.9", []],
    ["blindness", "H54.7", []],
    ["hearing loss", "H91.90", []],
    ["cancer pain|chronic pain", "G89.29", []],
    ["acute pain", "G89.11", []],
    ["chronic pain syndrome", "G89.4", []],
    ["malnutrition moderate|moderate malnutrition", "E44.0", []],
    ["dependence on wheelchair", "Z99.3", []],
    ["history of falling", "Z91.81", []],
    ["history of uti", "Z87.440", []],
    ["history of pneumonia", "Z87.01", []],
    ["history of cancer", "Z85.9", []],
    ["history of breast cancer", "Z85.3", []],
    ["history of prostate cancer", "Z85.46", []],
    ["history of colon cancer", "Z85.038", []],
    ["history of mrsa", "Z86.14", []],
    ["history of alcohol abuse", "F10.11", []],
    ["covid-19 history|history of covid", "Z86.16", []],
    ["hypertensive heart disease with heart failure", "I11.0", []],
    ["hypertensive heart and chronic kidney disease", "I13.10", []],
    ["pulmonary edema", "J81.0", []],
    ["cor pulmonale", "I27.81", []],
    ["sleep apnea", "G47.30", []],
    ["hyperparathyroidism", "E21.3", []],
    ["adrenal insufficiency", "E27.40", []],
    ["cushing'?s", "E24.9", []],
    ["sarcoidosis", "D86.9", []],
    ["amputation of toe", "Z89.429", []],
  ];
  for (const [term, code, alts] of SIMPLE) {
    RULES.push({ re: new RegExp("\\b(?:" + term + ")\\b", "i"), code, alts });
  }

  // A diagnosis mentioned only to rule it out, deny it, or as family history.
  const NEG_BEFORE_RE = /\b(?:no|not|denies|denied|negative\s+for|without\s+(?:evidence|signs?)\s+of|ruled?\s+out|r\/o|rule\s+out|no\s+(?:prior\s+|known\s+|personal\s+)?(?:history|hx|h\/o)\s+of|free\s+of|resolved|absence\s+of|unlikely|family\s+history|fhx|fh\s*:|mother|father|sister|brother|son|daughter|risk\s+(?:of|for))\b[^.;\n]{0,40}$/i;
  const NEG_AFTER_RE = /^[^.;\n]{0,25}\b(?:ruled\s+out|was\s+ruled\s+out|has\s+been\s+ruled\s+out|resolved|negative|unlikely|not\s+present)\b/i;
  const BULLET_RE = /^[\s\-–•*>#\d.)]+/;

  function sideOf(text) {
    const t = " " + String(text || "").toLowerCase() + " ";
    if (/\b(?:bilateral|bilat|both|b\/l|bles?)\b/.test(t)) return "bilateral";
    const left = /\b(?:left|lt|l\.|lle|lue)\b/.test(t);
    const right = /\b(?:right|rt|r\.|rle|rue)\b/.test(t);
    if (left && right) return "bilateral";
    if (left) return "left";
    if (right) return "right";
    return "none";
  }

  function isNegated(text, start, end) {
    const before = text.slice(Math.max(0, start - 60), start);
    const after = text.slice(end, end + 40);
    if (NEG_BEFORE_RE.test(before)) {
      // "history of stroke" is not negation, but "no history of stroke" is.
      return true;
    }
    return NEG_AFTER_RE.test(after);
  }

  function entryFor(code, lookup) {
    if (!code) return null;
    if (!lookup) return { code, description: "", billable: true };
    return lookup(code);
  }

  /**
   * Find curated diagnosis names in a piece of text.
   * Returns [{ code, description, billable, matchText, index, alternatives: [{code, description, billable}], negated }]
   * opts.lookup(code) -> official entry or null. opts.all: return every match in the text, not just the first.
   */
  function match(text, opts) {
    const options = opts || {};
    const lookup = options.lookup || null;
    const src = String(text || "");
    // 1. Every rule's matches.
    const cands = [];
    for (const rule of RULES) {
      const flags = rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g";
      const re = new RegExp(rule.re.source, flags);
      let m;
      while ((m = re.exec(src))) {
        if (!m[0]) { re.lastIndex++; continue; }
        cands.push({ rule, m, start: m.index, end: m.index + m[0].length });
      }
    }
    // 2. Longest match wins; overlapping shorter ones are dropped.
    cands.sort((x, y) => (y.end - y.start) - (x.end - x.start) || x.start - y.start);
    const taken = [];
    const out = [];
    for (const c of cands) {
      const { rule, m, start, end } = c;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      // A more specific match already coded this clause ("acute on chronic
      // diastolic heart failure" must not also give "heart failure").
      const cat = String(rule.code || [].concat((rule.side || {}).none || "")[0] || "").slice(0, 3);
      const clauseStart = Math.max(src.lastIndexOf(",", start), src.lastIndexOf(";", start), src.lastIndexOf("\n", start), src.lastIndexOf(".", start - 1));
      const clauseEndRaw = src.slice(end).search(/[,;\n]|\.(?:\s|$)/);
      const clauseEnd = clauseEndRaw < 0 ? src.length : end + clauseEndRaw;
      if (cat && out.some((o) => o.code.slice(0, 3) === cat && o.index > clauseStart && o.index < clauseEnd)) continue;
      taken.push([start, end]);
      const negated = isNegated(src, start, end);
      let codes;
      if (rule.side) {
        const around = src.slice(Math.max(0, start - 30), Math.min(src.length, end + 20));
        const s = sideOf(m[0]) !== "none" ? sideOf(m[0]) : sideOf(around);
        const pick = rule.side[s] || rule.side.none;
        codes = Array.isArray(pick) ? pick : [pick];
      } else {
        codes = [rule.code];
      }
      const altCodes = [];
      if (rule.side) for (const v of Object.values(rule.side)) for (const x of [].concat(v)) altCodes.push(x);
      for (const x of rule.alts || []) altCodes.push(x);
      for (const code of codes) {
        const entry = entryFor(code, lookup);
        if (!entry) continue;
        const alternatives = [];
        const seen = new Set([entry.code]);
        for (const x of altCodes) {
          const e = entryFor(x, lookup);
          if (!e || seen.has(e.code)) continue;
          seen.add(e.code);
          alternatives.push({ code: e.code, description: e.description, billable: e.billable });
        }
        out.push({ code: entry.code, description: entry.description, billable: entry.billable !== false, matchText: m[0], index: start, alternatives, negated });
      }
    }
    out.sort((x, y) => x.index - y.index);
    return options.all === false ? out.slice(0, 1) : out;
  }

  function codesInRules() {
    const all = new Set();
    for (const r of RULES) {
      if (r.code) all.add(r.code);
      if (r.side) for (const v of Object.values(r.side)) for (const c of [].concat(v)) all.add(c);
      for (const c of r.alts || []) all.add(c);
    }
    return [...all];
  }

  return { match, sideOf, isNegated, codesInRules, RULES, BULLET_RE };
});
