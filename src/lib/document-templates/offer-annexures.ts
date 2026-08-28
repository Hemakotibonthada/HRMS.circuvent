// OFFER LETTER ANNEXURES
//
// The offer letter's main letter and its Annexures A-F live inline in
// `catalog.ts`, built to the founder's own clause-by-clause specification -
// compensation, statutory benefits, the numbered terms, code of conduct, data
// protection, joining checklist. Annexures G and H, and the acceptance page,
// are assembled from the three exports below and interpolated into the same
// letter by `catalog.ts` - they live in this separate file only because their
// clause text is long enough that it does not belong in the same file as the
// document catalogue itself (see "still stands on its own merits" below).
// This file used to also carry a second,
// independently-drafted set of blocks covering the same ground: a second
// terms-and-conditions annexure, a second statutory-benefits annexure, a
// second code-of-conduct annexure, and a second data-protection annexure. All
// four were spliced into the letter after the candidate's acceptance page,
// which is worse than the duplication itself - an annexure a candidate has
// already signed past is not obviously part of what they agreed to, and a
// second "Annexure 3" appearing under a letter that already has a "Annexure
// B" covering the identical statute is exactly the kind of disagreement
// between two clauses on one subject that gets construed against the drafter,
// which is us.
//
// Those four blocks were deleted, not merely left unexported, once a clause-
// by-clause comparison against the inline Annexures B/C/D/E confirmed real
// duplication in every case, with the inline versions consistently the more
// precise ones (they cite specific sections - Article 276, Income Tax Act
// section 192 and 115BAC, POSH Act sections 4 and 16 - where the deleted
// blocks named only the Act). Nothing in them was thrown away silently: the
// handful of facts they carried that the inline annexures genuinely lacked -
// the Labour Welfare Fund deduction, a Deductions-from-salary clause under the
// Payment of Wages Act 1936, an Unauthorised-absence clause, and five code-of-
// conduct items (integrity, non-discrimination, insider information,
// substance misuse, raising a concern) - were folded into the inline
// annexures directly, so that fact exists exactly once in the letter instead
// of zero or two times.
//
// What remains here are the three blocks that were genuinely additive rather
// than duplicative: a full confidentiality-and-intellectual-property annexure
// (the inline letter had only two brief clauses on this, clauses 11 and 12 of
// Annexure C, which now point here instead of restating it), a full leave and
// attendance annexure (the inline letter committed the company to "the
// leave policy" without ever stating an entitlement), and the acceptance page
// itself, which has to be the true last page of the document for the reason
// its own comment below explains. Splitting this out of `catalog.ts` still
// stands on its own merits even with three blocks instead of seven: that file
// is a register of what documents exist, and clause text this long belongs
// somewhere a person is not scrolling past every time they add a template.
//
// TOKENS
// Only tokens already present in the offer letter body are used here. That is
// not a stylistic preference: `render()` in `src/lib/document-rules.ts` has no
// conditionals, so a token nothing populates is emitted literally, and
// "{{indemnity_cap}}" printed inside a signed contract is worse than the clause
// being absent. `catalog.test.ts` checks these bodies against
// `src/lib/offer-rules.ts`, which forbids `engagement_end_date` and the
// non-applicable compensation tokens on a permanent offer - so a clause that
// starts promising an intern a gratuity provision fails the build rather than
// reaching a candidate.
//
// CROSS-REFERENCES
// Every "Annexure X" reference in the three blocks below points to the letter
// as it is actually lettered in `catalog.ts` (A through J, in the order the
// letter presents them) rather than to a numbering scheme private to this
// file. A cross-reference that only makes sense against a draft nobody signs
// is worse than no cross-reference, because a candidate who checks it finds
// nothing.


/**
 * Confidentiality and intellectual property.
 *
 * The longest annexure, and deliberately so: this is the part that is
 * litigated. Clauses 11 and 12 of Annexure C incorporate it by reference,
 * rather than restating what follows at half the length and creating a
 * second, slightly different version of the same undertaking.
 */
export const OFFER_CONFIDENTIALITY_IP = `
      <div class="section">
        <div class="section-body">
          <p>
            This annexure is incorporated into your contract by clauses 11 and 12 of Annexure C. In it,
            "Company" means {{company_name}} and "you" means {{full_name}}.
          </p>

          <p><strong>1. Confidential information.</strong>
            Confidential information means information of the Company or of its customers,
            suppliers or partners which is not public, in whatever form it is held, including:
            source code, designs, architecture and technical documentation; algorithms, models and
            training data; product and release plans; pricing, margins, forecasts and financial
            results; customer and prospect lists and the terms agreed with them; supplier terms;
            employee personal data and compensation; security configurations, credentials and
            vulnerability information; and anything created by you in the course of your
            employment. It includes information you infer from the above, and information a
            customer entrusts to us.</p>

          <p><strong>2. What is not confidential.</strong>
            Information that is or becomes public other than through a breach by you; that you
            already lawfully held without a duty of confidence, and can show you did; or that you
            independently develop without using confidential information. Information does not
            stop being confidential because it is easy to remember or because you could
            reconstruct it.</p>

          <p><strong>3. Your obligations.</strong>
            You will keep confidential information confidential; use it only to do your job; not
            disclose it to anyone inside the Company who does not need it, or to anyone outside
            the Company without written authority; and protect it in accordance with our security
            policy. You will not copy it other than as your work requires, and will not store it
            on a personal device or personal account.</p>

          <p><strong>4. Duration.</strong>
            These obligations begin when you accept this offer - including during any period
            before you join - and continue after your employment ends for as long as the
            information remains confidential. For a trade secret, that is indefinitely.</p>

          <p><strong>5. Compelled disclosure.</strong>
            If you are required by law or by a court to disclose confidential information, you may
            do so, but you will tell us first if you are lawfully able to, so that we can seek
            protective relief, and you will disclose only what is required.</p>

          <p><strong>6. Ownership of intellectual property.</strong>
            All intellectual property you create in the course of your employment, or using
            Company time, equipment, materials or confidential information, belongs to the Company
            from the moment it is created. This covers inventions, software, designs, databases,
            documentation, know-how and improvements, and applies whether or not the work was
            assigned to you and whether or not it was created during working hours.</p>

          <p><strong>7. Assignment.</strong>
            To the extent any such right does not vest in the Company automatically, you assign it
            to the Company now, including future rights as they come into existence. Under the
            Patents Act 1970 and the Copyright Act 1957 you will, at our expense, sign any document
            and give any assistance reasonably needed to obtain, register, maintain or enforce
            those rights, both during your employment and afterwards.</p>

          <p><strong>8. Moral rights.</strong>
            To the extent permitted by section 57 of the Copyright Act 1957, you waive the moral
            rights you would otherwise have in work created in the course of your employment. This
            waiver does not permit the Company to treat your work in a way that is derogatory to
            your reputation.</p>

          <p><strong>9. Disclosure of what you create.</strong>
            You will promptly disclose to the Company any invention or work covered by clause 6.
            Disclosure is how the Company establishes what it owns; failing to disclose is a
            breach even if you never exploit the work yourself.</p>

          <p><strong>10. Pre-existing and personal work.</strong>
            Clause 6 does not apply to intellectual property you created before your employment,
            or that you create entirely in your own time without using Company equipment,
            materials or confidential information, and which does not relate to the Company's
            business or to work you do for it. If you wish to rely on this clause for a specific
            piece of work, list it in writing when you accept this offer, or notify us before you
            begin it. Work you never told us about is not protected by this clause.</p>

          <p><strong>11. Open source and third-party material.</strong>
            You will not incorporate third-party material, including open-source code, into a
            Company product except in accordance with our policy and the applicable licence.
            Incorporating code under a licence that would require the Company to publish its own
            source is a serious matter, because the consequence falls on the Company rather than
            on you.</p>

          <p><strong>12. Return of material.</strong>
            On or before your last working day - and at any time we ask - you will return every
            document, device, credential and copy of confidential information in your possession,
            and permanently delete any copy held on a personal device or account. If asked, you
            will confirm in writing that you have done so.</p>

          <p><strong>13. Third-party confidential information.</strong>
            You will not bring to the Company, or use in your work, confidential information
            belonging to a former employer or any other third party. If you are subject to an
            obligation to a former employer that could restrict your work here, you must tell us
            before you join. We do not want, and will not accept, another company's confidential
            information.</p>

          <p><strong>14. Remedies.</strong>
            You acknowledge that damages alone may not be an adequate remedy for breach of this
            annexure, and that the Company may seek injunctive relief in addition to any other
            remedy. This does not entitle the Company to relief it would not otherwise be granted.</p>

          <p><strong>15. Survival.</strong>
            This annexure survives the end of your employment however it arises, and continues to
            bind you regardless of the reason your employment ended.</p>
        </div>
      </div>
`;

/**
 * Acceptance page.
 *
 * Kept as the true last block so it is the last page. An acceptance signature
 * at the end of every annexure is evidence the annexures were part of what was
 * signed; a signature that comes before some of them, as this document's
 * wiring used to place it, is evidence of nothing and invites the candidate to
 * argue the later annexures were never part of the deal they agreed to.
 */
export const OFFER_ACCEPTANCE = `
      <div class="section">
        <div class="section-body">
          <p>
            To accept this offer, sign below and return the complete letter, including every
            annexure, to {{hr_contact_email}} on or before {{offer_valid_until}}.
          </p>
          <p>
            I, {{full_name}}, accept the offer of employment as {{position_title}} with
            {{company_name}} on the terms set out in this letter and in Annexures A to J. I confirm
            that I have read those annexures; that the information I gave during the recruitment
            process is true and complete; that I am not subject to any obligation to a former
            employer that would prevent me performing this role; and that I will produce the
            documents listed in Annexure F on my first day.
          </p>

          <div class="details">
            <div class="details-row">
              <span class="details-label">Signature</span>
              <span class="details-value">&nbsp;</span>
            </div>
            <div class="details-row">
              <span class="details-label">Name</span>
              <span class="details-value">{{full_name}}</span>
            </div>
            <div class="details-row">
              <span class="details-label">Date of acceptance</span>
              <span class="details-value">&nbsp;</span>
            </div>
            <div class="details-row">
              <span class="details-label">Proposed start date</span>
              <span class="details-value">{{start_date}}</span>
            </div>
          </div>

          <p>
            We are glad to be making you this offer, and we are looking forward to your joining us.
            If anything in this letter is unclear, please raise it with {{hr_contact_name}} at
            {{hr_contact_email}} before you sign rather than after.
          </p>

          <div class="footer">
            <p>
              For and on behalf of {{company_name}}<br />
              {{signatory_name}}<br />
              {{signatory_title}}
            </p>
          </div>
        </div>
      </div>
`;

/**
 * Leave, holidays and attendance.
 *
 * Added because the letter committed the company to a leave policy without
 * stating a single entitlement, and leave is the term new joiners ask about
 * most often. It is also the term most often disputed on exit, since untaken
 * leave becomes money in the final settlement - so the accrual and encashment
 * rules belong in the signed document rather than in a policy page that can be
 * changed afterwards without the employee's knowledge.
 */
export const OFFER_LEAVE_AND_ATTENDANCE = `
      <div class="section">
        <div class="section-body">
          <p>
            Entitlements below are for a full leave year worked in full. In your first year they
            accrue in proportion to the part of the year you work, counted from your date of
            joining. The leave year runs with the calendar year.
          </p>

          <p><strong>1. Earned leave.</strong>
            Earned leave accrues monthly and may be taken once accrued, with your manager's
            approval. Approval will not be withheld unreasonably, but leave is subject to the
            needs of the business and to notice appropriate to the length of absence.</p>

          <p><strong>2. Carry-forward.</strong>
            Untaken earned leave carries forward to the following year up to the limit set in the
            leave policy. Leave above that limit lapses at the year end. We will tell you before
            the year end if you are holding leave that is about to lapse; it is not in anyone's
            interest for leave to be lost silently.</p>

          <p><strong>3. Encashment.</strong>
            Accrued and untaken earned leave is encashed in your final settlement at your
            last-drawn basic salary. Encashment during employment is permitted only where the
            leave policy provides for it. Casual and sick leave are not encashable.</p>

          <p><strong>4. Casual and sick leave.</strong>
            Casual leave is for short, unforeseen absences and does not carry forward. Sick leave
            may require a certificate from a registered medical practitioner for an absence of
            more than two consecutive working days. Sick leave is not a substitute for earned
            leave and is not encashable.</p>

          <p><strong>5. Public holidays.</strong>
            You are entitled to the public holidays published in the company's holiday calendar
            for your work location, which is issued before the start of each calendar year. The
            list reflects the holidays notified for the State in which you are based, so it
            differs between locations. Where the business requires you to work on a published
            holiday, you will receive compensatory time off.</p>

          <p><strong>6. Maternity, paternity and adoption leave.</strong>
            Maternity leave is granted under the Maternity Benefit Act 1961 as described in
            Annexure B, and no company policy reduces it. Paternity and adoption leave are granted
            under the company's leave policy.</p>

          <p><strong>7. Bereavement leave.</strong>
            Leave on the death of an immediate family member is granted under the leave policy and
            is not deducted from any other entitlement.</p>

          <p><strong>8. Leave without pay.</strong>
            Leave without pay is granted only by exception and with written approval. It does not
            count towards continuous service for the purposes of gratuity, and a period of leave
            without pay extends any probation by the same duration.</p>

          <p><strong>9. Attendance.</strong>
            You are required to record your attendance by the means in use at your location. Where
            an electronic access or biometric system is used, the record it produces is the record
            of your attendance, and it feeds directly into payroll. If you believe a record is
            wrong, raise it with {{hr_contact_name}} within the same pay period, while it can
            still be corrected before the payroll run it affects.</p>

          <p><strong>10. Leave during notice.</strong>
            Leave may not be taken during your notice period without our written agreement, and
            leave taken by agreement during notice does not extend the notice period. The purpose
            of notice is handover, which is defeated if it is spent on leave.</p>
        </div>
      </div>
`;

/**
 * These three blocks are consumed directly by `catalog.ts`, each under its own
 * `<h2>` heading (Annexure G, Annexure H, and the final Acceptance page), the
 * same way Annexures A through F are headed. There is deliberately no combined
 * `OFFER_ANNEXURES` string here any more: the previous version pre-joined the
 * blocks and spliced the result in one place, which is exactly how a
 * duplicate terms-and-conditions annexure and a signature page ended up
 * sandwiched in the wrong order in the first place. Importing each block by
 * name and placing it explicitly means the order in `catalog.ts` is the order
 * that renders, with nothing hidden in a `.join()` call.
 */
