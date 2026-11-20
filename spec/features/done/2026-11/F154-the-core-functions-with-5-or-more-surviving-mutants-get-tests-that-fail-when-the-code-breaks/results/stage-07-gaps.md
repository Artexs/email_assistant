| file | function | before | after |
| --- | --- | --- | --- |
| packages/core/src/triage/suspicious.ts | isOneEditApart | 29 | 29 |
| packages/core/src/triage/suspicious.ts | punycodeDecode | 23 | 23 |
| packages/core/src/triage/suspicious.ts | adapt | 18 | 18 |
| packages/core/src/triage/dkim-pass.ts | trustedAlignedPassDomains | 17 | 8 |
| packages/core/src/triage/suspicious.ts | digitValue | 16 | 16 |
| packages/core/src/triage/suspicious.ts | trustedAuthResults | 14 | 5 |
| packages/core/src/triage/suspicious.ts | isLookalike | 9 | 9 |
| packages/core/src/triage/dkim-pass.ts | stripCommentsAndQuotes | 9 | 3 |
| packages/core/src/triage/suspicious.ts | skeleton | 8 | 8 |
| packages/core/src/triage/dkim-signature.ts | tagsOf | 8 | 1 |
| packages/core/src/triage/suspicious.ts | isRiskyAttachment | 7 | 3 |
| packages/core/src/triage/suspicious.ts | isDisplayNameSpoof | 7 | 2 |
| packages/core/src/triage/suspicious.ts | foldName | 6 | 1 |
| packages/core/src/triage/suspicious.ts | domainOfAddress | 5 | 1 |
| packages/core/src/triage/dkim-signature.ts | signatureOf | 4 | 4 |
| packages/core/src/triage/dkim-pass.ts | alignedDomains | 4 | 1 |
| packages/core/src/triage/suspicious.ts | isReplyToMismatch | 3 | 0 |
| packages/core/src/triage/suspicious.ts | foldHost | 2 | 2 |
| packages/core/src/triage/suspicious.ts | registrableDomain | 2 | 2 |
| packages/core/src/triage/suspicious.ts | registrableDomainShared | 2 | 2 |
| packages/core/src/triage/suspicious.ts | foldLabel | 1 | 1 |
| packages/core/src/triage/suspicious.ts | isAuthFail | 1 | 1 |
| packages/core/src/triage/suspicious.ts | assessSuspicious | 1 | 0 |

| test file | case | kills |
| --- | --- | --- |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the empty signing domain and the first part, through hasCoveredDkimPass > a empty From domain never aligns with the empty signing domain of header.d=. | 2 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the empty signing domain and the first part, through hasCoveredDkimPass > a quoted string next to the domain is not removed: it does not join the domain | 1 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the empty signing domain and the first part, through hasCoveredDkimPass > a white space From domain never aligns with the empty signing domain of header.d=. | 3 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the empty signing domain and the first part, through hasCoveredDkimPass > an authserv-id that reads like a result is never a result | 1 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > a ) after a closed comment | 2 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > a From domain with a domain below the signing domain with a sibling label | 1 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > a From domain with several trailing dots | 2 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > a From domain with spaces, capitals and a trailing dot | 2 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > a comment between pass and header.d counts as a space | 3 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > header.d with spaces around = | 1 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > spaces around = and tabs before the result | 3 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > the signing domain with a trailing dot | 1 |
| packages/core/src/triage/dkim-pass.test.ts | src/triage/dkim-pass.test.ts > the lexing of the Authentication-Results value and the alignment, edge cases > the signing domain with several trailing dots | 2 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a colon that starts the line: the tags follow it | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a line with no colon gives no signature | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a repeated h gives no signature | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a repeated tag that is not read gives no signature | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a repeated tag with spaces around its name gives no signature | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a tag whose name is empty (the = comes first) gives no signature | 3 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > a tag whose name is only white space gives no signature | 3 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > an empty h gives a signature with no names | 1 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > empty parts between and after the tags are skipped | 3 |
| packages/core/src/triage/dkim-signature.test.ts | src/triage/dkim-signature.test.ts > dkimSignaturesOf: the tags of one header line > the first = splits a tag: a later = stays in the value of h and drops that name | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dkim=fail alone | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dkim=fail and spf=fail | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail after a space | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail after other results | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail alone | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail before a comment | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail from an id that is not trusted | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail glued to a word | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail in brackets | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail in upper case | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=fail with spaces around = | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=failed | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > dmarc=pass | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > no value | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=fail alone | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=fail and dkim=fail | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=fail and dkim=failed | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=fail and dkim=pass | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=failed and dkim=fail | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: auth_fail > spf=pass and dkim=fail | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > a protected list with no entry gives no spoof | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected   : a protected name of white space | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Fiona Kowal: a ligature (compatibility fold) | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: a name of white space | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: a protected name with a diacritic | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: a protected name with a double space and capitals | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: a protected name with a tab and spaces around it | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: an address with another local part | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: another address in the name | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: another address inside a text | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: another name | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: no name | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: only the first name | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address in another case | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address in full-width letters | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address in the name | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address inside a text | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address with a trailing dot | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan Kowalski: the same address with several trailing dots | 4 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Jan: a protected name of one word | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Ján Kowalski: a diacritic in the protected name | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Lukasz Nowak: an upper case l with a stroke | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Paweł Nowak: l with a stroke | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Søren Berg: o with a stroke | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: display_name_spoof > with protected Đorđe Kovač: d with a stroke | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a From address with no @ | 5 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a From address with no domain | 6 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a From address with only a domain | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a From domain with spaces around it | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a domain with spaces around it | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a mailing list gets no mismatch | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a named address of another domain | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > a sub-domain of the same registrable domain | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > an address with a blank domain | 5 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > an address with no @ | 4 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > an address with no domain | 5 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > another domain | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > no Reply-To | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > the last @ gives the domain | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > the same address | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: reply_to_mismatch > the second address is another domain | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a double extension in upper case | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a java archive type | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a macro document extension | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a name that ends in a dot | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a name that is only a risky extension | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a name with no dot | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a risky extension before the last dot | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a risky extension with spaces around the name | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a risky type in upper case | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a risky type with a parameter | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a risky type with spaces around it | 2 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a safe name | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > a safe type with a parameter | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > an empty type and no name | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > no name and a safe type | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > assessSuspicious: risky_attachment > one risky attachment among safe ones gives the reason once | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a full-width id and semicolon (NFKC) | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a sub-domain of a trusted id | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a tab and a version after the id | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a trusted id with no semicolon: the last character is not dropped | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a trusted list with a blank entry next to a real one | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a trusted list with an empty entry does not trust a trailing dot | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a trusted list with several trailing dots | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a trusted list with upper case, spaces and a trailing dot | 3 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > a version after the id | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > the results keep everything after the first semicolon | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > the results of a trusted id | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > the value folded to lower case | 1 |
| packages/core/src/triage/suspicious-auth.test.ts | src/triage/suspicious-auth.test.ts > trustedAuthResults > white space before the id | 2 |

0 new cases kill no before-survivor
