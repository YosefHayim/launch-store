// Country availability from Google Play edits.countryavailability.

export type PlayCountryAvailability = Readonly<{
  restOfWorld?: boolean;
  countries: Readonly<{ countryCode: string }>[];
}>;
