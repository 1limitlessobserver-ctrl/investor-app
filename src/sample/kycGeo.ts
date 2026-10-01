// The website's KYC geography and option lists, copied from the platform's src/lib/kyc/geo.ts
// (below, unchanged) so the app offers exactly the countries, US states and "Additional details"
// choices of the website's wizard and review screen. Pure data: re-copy when the platform's file
// changes. Plan B's helpers/kycGeo.tsx is the same copy.
//
// Added here: KYC_DOCUMENT_TYPES (the submission's `docType` values, with their labels) and
// `kycGeo`, which gathers the lists for the verification wizard. The platform has no list of
// "purposes" (the plan's guess): KycSubmission asks for `annualIncome` and `investmentExperience`,
// so `kycGeo` offers those two lists instead.
import type { KycDocType } from '../api/types';

export interface Country {
  /** ISO-3166 alpha-2 code. */
  code: string;
  name: string;
  /** International dialing code (without the leading +). */
  dial: string;
}

// Comprehensive, alphabetical country list with dialing codes. Common markets
// are present up front via the dropdown's own ordering; this stays alphabetical.
export const COUNTRIES: Country[] = [
  { code: 'AF', name: 'Afghanistan', dial: '93' },
  { code: 'AL', name: 'Albania', dial: '355' },
  { code: 'DZ', name: 'Algeria', dial: '213' },
  { code: 'AD', name: 'Andorra', dial: '376' },
  { code: 'AO', name: 'Angola', dial: '244' },
  { code: 'AG', name: 'Antigua and Barbuda', dial: '1' },
  { code: 'AR', name: 'Argentina', dial: '54' },
  { code: 'AM', name: 'Armenia', dial: '374' },
  { code: 'AU', name: 'Australia', dial: '61' },
  { code: 'AT', name: 'Austria', dial: '43' },
  { code: 'AZ', name: 'Azerbaijan', dial: '994' },
  { code: 'BS', name: 'Bahamas', dial: '1' },
  { code: 'BH', name: 'Bahrain', dial: '973' },
  { code: 'BD', name: 'Bangladesh', dial: '880' },
  { code: 'BB', name: 'Barbados', dial: '1' },
  { code: 'BY', name: 'Belarus', dial: '375' },
  { code: 'BE', name: 'Belgium', dial: '32' },
  { code: 'BZ', name: 'Belize', dial: '501' },
  { code: 'BJ', name: 'Benin', dial: '229' },
  { code: 'BT', name: 'Bhutan', dial: '975' },
  { code: 'BO', name: 'Bolivia', dial: '591' },
  { code: 'BA', name: 'Bosnia and Herzegovina', dial: '387' },
  { code: 'BW', name: 'Botswana', dial: '267' },
  { code: 'BR', name: 'Brazil', dial: '55' },
  { code: 'BN', name: 'Brunei', dial: '673' },
  { code: 'BG', name: 'Bulgaria', dial: '359' },
  { code: 'BF', name: 'Burkina Faso', dial: '226' },
  { code: 'BI', name: 'Burundi', dial: '257' },
  { code: 'KH', name: 'Cambodia', dial: '855' },
  { code: 'CM', name: 'Cameroon', dial: '237' },
  { code: 'CA', name: 'Canada', dial: '1' },
  { code: 'CV', name: 'Cape Verde', dial: '238' },
  { code: 'CF', name: 'Central African Republic', dial: '236' },
  { code: 'TD', name: 'Chad', dial: '235' },
  { code: 'CL', name: 'Chile', dial: '56' },
  { code: 'CN', name: 'China', dial: '86' },
  { code: 'CO', name: 'Colombia', dial: '57' },
  { code: 'KM', name: 'Comoros', dial: '269' },
  { code: 'CG', name: 'Congo', dial: '242' },
  { code: 'CD', name: 'Congo (DRC)', dial: '243' },
  { code: 'CR', name: 'Costa Rica', dial: '506' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '225' },
  { code: 'HR', name: 'Croatia', dial: '385' },
  { code: 'CU', name: 'Cuba', dial: '53' },
  { code: 'CY', name: 'Cyprus', dial: '357' },
  { code: 'CZ', name: 'Czechia', dial: '420' },
  { code: 'DK', name: 'Denmark', dial: '45' },
  { code: 'DJ', name: 'Djibouti', dial: '253' },
  { code: 'DM', name: 'Dominica', dial: '1' },
  { code: 'DO', name: 'Dominican Republic', dial: '1' },
  { code: 'EC', name: 'Ecuador', dial: '593' },
  { code: 'EG', name: 'Egypt', dial: '20' },
  { code: 'SV', name: 'El Salvador', dial: '503' },
  { code: 'GQ', name: 'Equatorial Guinea', dial: '240' },
  { code: 'ER', name: 'Eritrea', dial: '291' },
  { code: 'EE', name: 'Estonia', dial: '372' },
  { code: 'SZ', name: 'Eswatini', dial: '268' },
  { code: 'ET', name: 'Ethiopia', dial: '251' },
  { code: 'FJ', name: 'Fiji', dial: '679' },
  { code: 'FI', name: 'Finland', dial: '358' },
  { code: 'FR', name: 'France', dial: '33' },
  { code: 'GA', name: 'Gabon', dial: '241' },
  { code: 'GM', name: 'Gambia', dial: '220' },
  { code: 'GE', name: 'Georgia', dial: '995' },
  { code: 'DE', name: 'Germany', dial: '49' },
  { code: 'GH', name: 'Ghana', dial: '233' },
  { code: 'GR', name: 'Greece', dial: '30' },
  { code: 'GD', name: 'Grenada', dial: '1' },
  { code: 'GT', name: 'Guatemala', dial: '502' },
  { code: 'GN', name: 'Guinea', dial: '224' },
  { code: 'GW', name: 'Guinea-Bissau', dial: '245' },
  { code: 'GY', name: 'Guyana', dial: '592' },
  { code: 'HT', name: 'Haiti', dial: '509' },
  { code: 'HN', name: 'Honduras', dial: '504' },
  { code: 'HK', name: 'Hong Kong', dial: '852' },
  { code: 'HU', name: 'Hungary', dial: '36' },
  { code: 'IS', name: 'Iceland', dial: '354' },
  { code: 'IN', name: 'India', dial: '91' },
  { code: 'ID', name: 'Indonesia', dial: '62' },
  { code: 'IR', name: 'Iran', dial: '98' },
  { code: 'IQ', name: 'Iraq', dial: '964' },
  { code: 'IE', name: 'Ireland', dial: '353' },
  { code: 'IL', name: 'Israel', dial: '972' },
  { code: 'IT', name: 'Italy', dial: '39' },
  { code: 'JM', name: 'Jamaica', dial: '1' },
  { code: 'JP', name: 'Japan', dial: '81' },
  { code: 'JO', name: 'Jordan', dial: '962' },
  { code: 'KZ', name: 'Kazakhstan', dial: '7' },
  { code: 'KE', name: 'Kenya', dial: '254' },
  { code: 'KI', name: 'Kiribati', dial: '686' },
  { code: 'KW', name: 'Kuwait', dial: '965' },
  { code: 'KG', name: 'Kyrgyzstan', dial: '996' },
  { code: 'LA', name: 'Laos', dial: '856' },
  { code: 'LV', name: 'Latvia', dial: '371' },
  { code: 'LB', name: 'Lebanon', dial: '961' },
  { code: 'LS', name: 'Lesotho', dial: '266' },
  { code: 'LR', name: 'Liberia', dial: '231' },
  { code: 'LY', name: 'Libya', dial: '218' },
  { code: 'LI', name: 'Liechtenstein', dial: '423' },
  { code: 'LT', name: 'Lithuania', dial: '370' },
  { code: 'LU', name: 'Luxembourg', dial: '352' },
  { code: 'MO', name: 'Macau', dial: '853' },
  { code: 'MG', name: 'Madagascar', dial: '261' },
  { code: 'MW', name: 'Malawi', dial: '265' },
  { code: 'MY', name: 'Malaysia', dial: '60' },
  { code: 'MV', name: 'Maldives', dial: '960' },
  { code: 'ML', name: 'Mali', dial: '223' },
  { code: 'MT', name: 'Malta', dial: '356' },
  { code: 'MR', name: 'Mauritania', dial: '222' },
  { code: 'MU', name: 'Mauritius', dial: '230' },
  { code: 'MX', name: 'Mexico', dial: '52' },
  { code: 'MD', name: 'Moldova', dial: '373' },
  { code: 'MC', name: 'Monaco', dial: '377' },
  { code: 'MN', name: 'Mongolia', dial: '976' },
  { code: 'ME', name: 'Montenegro', dial: '382' },
  { code: 'MA', name: 'Morocco', dial: '212' },
  { code: 'MZ', name: 'Mozambique', dial: '258' },
  { code: 'MM', name: 'Myanmar', dial: '95' },
  { code: 'NA', name: 'Namibia', dial: '264' },
  { code: 'NP', name: 'Nepal', dial: '977' },
  { code: 'NL', name: 'Netherlands', dial: '31' },
  { code: 'NZ', name: 'New Zealand', dial: '64' },
  { code: 'NI', name: 'Nicaragua', dial: '505' },
  { code: 'NE', name: 'Niger', dial: '227' },
  { code: 'NG', name: 'Nigeria', dial: '234' },
  { code: 'MK', name: 'North Macedonia', dial: '389' },
  { code: 'NO', name: 'Norway', dial: '47' },
  { code: 'OM', name: 'Oman', dial: '968' },
  { code: 'PK', name: 'Pakistan', dial: '92' },
  { code: 'PW', name: 'Palau', dial: '680' },
  { code: 'PA', name: 'Panama', dial: '507' },
  { code: 'PG', name: 'Papua New Guinea', dial: '675' },
  { code: 'PY', name: 'Paraguay', dial: '595' },
  { code: 'PE', name: 'Peru', dial: '51' },
  { code: 'PH', name: 'Philippines', dial: '63' },
  { code: 'PL', name: 'Poland', dial: '48' },
  { code: 'PT', name: 'Portugal', dial: '351' },
  { code: 'QA', name: 'Qatar', dial: '974' },
  { code: 'RO', name: 'Romania', dial: '40' },
  { code: 'RU', name: 'Russia', dial: '7' },
  { code: 'RW', name: 'Rwanda', dial: '250' },
  { code: 'KN', name: 'Saint Kitts and Nevis', dial: '1' },
  { code: 'LC', name: 'Saint Lucia', dial: '1' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', dial: '1' },
  { code: 'WS', name: 'Samoa', dial: '685' },
  { code: 'SM', name: 'San Marino', dial: '378' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966' },
  { code: 'SN', name: 'Senegal', dial: '221' },
  { code: 'RS', name: 'Serbia', dial: '381' },
  { code: 'SC', name: 'Seychelles', dial: '248' },
  { code: 'SL', name: 'Sierra Leone', dial: '232' },
  { code: 'SG', name: 'Singapore', dial: '65' },
  { code: 'SK', name: 'Slovakia', dial: '421' },
  { code: 'SI', name: 'Slovenia', dial: '386' },
  { code: 'SB', name: 'Solomon Islands', dial: '677' },
  { code: 'SO', name: 'Somalia', dial: '252' },
  { code: 'ZA', name: 'South Africa', dial: '27' },
  { code: 'KR', name: 'South Korea', dial: '82' },
  { code: 'SS', name: 'South Sudan', dial: '211' },
  { code: 'ES', name: 'Spain', dial: '34' },
  { code: 'LK', name: 'Sri Lanka', dial: '94' },
  { code: 'SD', name: 'Sudan', dial: '249' },
  { code: 'SR', name: 'Suriname', dial: '597' },
  { code: 'SE', name: 'Sweden', dial: '46' },
  { code: 'CH', name: 'Switzerland', dial: '41' },
  { code: 'SY', name: 'Syria', dial: '963' },
  { code: 'TW', name: 'Taiwan', dial: '886' },
  { code: 'TJ', name: 'Tajikistan', dial: '992' },
  { code: 'TZ', name: 'Tanzania', dial: '255' },
  { code: 'TH', name: 'Thailand', dial: '66' },
  { code: 'TL', name: 'Timor-Leste', dial: '670' },
  { code: 'TG', name: 'Togo', dial: '228' },
  { code: 'TO', name: 'Tonga', dial: '676' },
  { code: 'TT', name: 'Trinidad and Tobago', dial: '1' },
  { code: 'TN', name: 'Tunisia', dial: '216' },
  { code: 'TR', name: 'Türkiye', dial: '90' },
  { code: 'TM', name: 'Turkmenistan', dial: '993' },
  { code: 'UG', name: 'Uganda', dial: '256' },
  { code: 'UA', name: 'Ukraine', dial: '380' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  { code: 'GB', name: 'United Kingdom', dial: '44' },
  { code: 'US', name: 'United States', dial: '1' },
  { code: 'UY', name: 'Uruguay', dial: '598' },
  { code: 'UZ', name: 'Uzbekistan', dial: '998' },
  { code: 'VU', name: 'Vanuatu', dial: '678' },
  { code: 'VE', name: 'Venezuela', dial: '58' },
  { code: 'VN', name: 'Vietnam', dial: '84' },
  { code: 'YE', name: 'Yemen', dial: '967' },
  { code: 'ZM', name: 'Zambia', dial: '260' },
  { code: 'ZW', name: 'Zimbabwe', dial: '263' },
];

// Codes surfaced at the top of the residence/tax dropdowns for fast selection.
export const PRIORITY_COUNTRY_CODES = ['US', 'GB', 'CA', 'AU', 'AE', 'SG', 'CH'];

export interface UsState {
  code: string;
  name: string;
}

export const US_STATES: UsState[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'GU', name: 'Guam' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'MP', name: 'Northern Mariana Islands' },
];

// ---- "Additional details" option lists (Step 4) ------------------------------
export const EMPLOYMENT_STATUS = [
  'Employed',
  'Self-employed',
  'Business owner',
  'Retired',
  'Student',
  'Not employed',
] as const;
export const SOURCE_OF_FUNDS = [
  'Employment income',
  'Business income',
  'Investment returns',
  'Inheritance',
  'Sale of property or assets',
  'Savings',
  'Other',
] as const;
export const ANNUAL_INCOME = [
  'Under $50,000',
  '$50,000 – $100,000',
  '$100,000 – $250,000',
  '$250,000 – $1,000,000',
  'Over $1,000,000',
] as const;
export const INVESTMENT_EXPERIENCE = [
  'None',
  'Limited (< 2 years)',
  'Good (2–5 years)',
  'Extensive (5+ years)',
  'Professional',
] as const;

const CODE_TO_COUNTRY = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Full country name for a code (falls back to the code itself). */
export function countryName(code?: string | null): string {
  if (!code) return '';
  return CODE_TO_COUNTRY.get(code)?.name ?? code;
}

/** International dial code (without +) for a country code, '' if unknown. */
export function dialCode(code?: string | null): string {
  if (!code) return '';
  return CODE_TO_COUNTRY.get(code)?.dial ?? '';
}

/** Regional-indicator flag emoji from an alpha-2 code (e.g. 'US' -> 🇺🇸). */
export function flagEmoji(code?: string | null): string {
  if (!code || code.length !== 2) return '🏳️';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** US-state full name for a 2-letter state code. */
export function usStateName(code?: string | null): string {
  if (!code) return '';
  return US_STATES.find((s) => s.code === code)?.name ?? code;
}

// ---- Added for the app ---------------------------------------------------------------------------

export const KYC_DOCUMENT_TYPES: ReadonlyArray<{ id: KycDocType; label: string }> = [
  { id: 'PASSPORT', label: 'Passport' },
  { id: 'DRIVERS_LICENSE', label: "Driver's license" },
  { id: 'NATIONAL_ID', label: 'National ID' },
];

export const kycGeo = {
  countries: COUNTRIES,
  priorityCountryCodes: PRIORITY_COUNTRY_CODES,
  usStates: US_STATES,
  documentTypes: KYC_DOCUMENT_TYPES,
  employmentStatuses: EMPLOYMENT_STATUS,
  sourcesOfFunds: SOURCE_OF_FUNDS,
  annualIncomes: ANNUAL_INCOME,
  investmentExperiences: INVESTMENT_EXPERIENCE,
  countryName,
  dialCode,
  flagEmoji,
  usStateName,
};
