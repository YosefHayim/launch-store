// Alternative distribution domains and the team public key.

/** One alternative-distribution domain */
export type AlternativeDistributionDomainResource = Readonly<{
  id: string;
  domain?: string;
  referenceName?: string;
}>;

/** The team's alternative-distribution **public** key */
export type AlternativeDistributionKeyResource = Readonly<{
  id: string;
  publicKey?: string;
}>;
