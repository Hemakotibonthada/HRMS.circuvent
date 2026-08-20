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
// as it is actually lettered in `catalog.ts` (A through H, in the order the
// letter presents them) rather than to a numbering scheme private to this
// file. A cross-reference that only makes sense against a draft nobody signs
// is worse than no cross-reference, because a candidate who checks it finds
// nothing.


/**
 * Numbered terms and conditions.
 *
 * Ordered roughly as the employment progresses - joining, then the working
 * relationship, then how it ends - because the clause an employee looks for is
 * almost always tied to where they are in that arc.
 */
export const OFFER_TERMS_AND_CONDITIONS = `
      <div class="section">
        <p class="section-title">Annexure 2 — Terms and conditions of employment</p>
        <div class="section-body">
          <p>
            These terms form part of your offer and, on your acceptance, part of your contract of
            employment with {{company_name}}. Where a clause refers to a company policy, the
            policy as amended from time to time applies, and the current version is available from
            {{hr_contact_email}} on request.
          </p>

          <p><strong>1. Offer validity and acceptance.</strong>
            This offer is open until {{offer_valid_until}}. Acceptance is by returning a signed
            copy of this letter, including the acceptance page at the end. If we have not received
            it by that date the offer lapses automatically, without further notice, and we are
            free to fill the position. An acceptance that alters any term is a counter-offer and
            is not binding on us unless we confirm the change in writing.</p>

          <p><strong>2. Conditions precedent.</strong>
            This offer, and your continued employment, are conditional on each of the following:
            satisfactory background verification; production of the original documents listed in
            Annexure 5; your being legally entitled to work in India; and your not being under any
            subsisting obligation to a former employer that would prevent you performing this
            role. If any condition is not met, we may withdraw this offer or terminate employment
            already commenced, in either case without liability beyond salary already earned.</p>

          <p><strong>3. Commencement and place of work.</strong>
            Your employment begins on {{start_date}} at {{work_location}}, working
            {{work_mode}}. If you do not commence on that date, and have not agreed a revised date
            with us in writing beforehand, this offer stands withdrawn.</p>

          <p><strong>4. Probation and confirmation.</strong>
            You will be on probation for {{probation_period}} from your date of joining. During
            probation either party may terminate on the shorter notice stated in clause 18.
            Confirmation is not automatic: it takes effect only when confirmed to you in writing.
            We may extend probation once, for a period not exceeding the original, where we
            consider more time is needed to assess your performance fairly. If your performance
            during probation is not satisfactory we will tell you what is deficient and give you a
            reasonable opportunity to address it before deciding.</p>

          <p><strong>5. Duties.</strong>
            You are employed as {{position_title}} at {{grade_level}} in the {{business_unit}}
            unit, reporting to {{manager_name}}. You will perform the duties of that role and such
            other duties consistent with your skills and seniority as we may reasonably assign.
            Your role, unit and reporting line may change with the needs of the business; a change
            that does not reduce your salary or seniority is not a change to this contract.</p>

          <p><strong>6. Hours of work.</strong>
            Your standard hours are {{working_hours}}. You may be required to work outside those
            hours where the role reasonably demands it. Hours worked are subject to the limits set
            by the Shops and Establishments legislation of the State in which you are based and,
            where applicable, the Factories Act 1948. No overtime is payable to employees in
            supervisory, managerial or administrative positions except where statute requires it.</p>

          <p><strong>7. Salary and review.</strong>
            Your gross salary is {{gross_salary}} a year, structured as set out in Annexure 1, and
            paid monthly in arrears by bank transfer, subject to deductions required by law.
            Salary is reviewed on the {{performance_review_cycle}} cycle. A review is an
            opportunity for an increase, not a guarantee of one, and no increase is due where
            performance or company results do not support it.</p>

          <p><strong>8. Performance pay.</strong>
            Performance pay of {{performance_pay_monthly}} a month and any variable component
            described in this letter are earned against the criteria communicated to you for the
            relevant period. Except where statute provides otherwise, variable pay is payable only
            if you are in employment and not under notice on the date it is due to be paid. We may
            change the structure of variable pay prospectively; we will not reduce a variable
            amount already earned for a completed period.</p>

          <p><strong>9. Deductions.</strong>
            We may deduct from your salary any sum you owe us, including overpaid salary, an
            unreturned company asset, an outstanding advance, and notice not served under
            clause 18. Deductions are made in accordance with the Payment of Wages Act 1936 and,
            where consent is required, we will obtain it.</p>

          <p><strong>10. Taxes.</strong>
            Income tax will be deducted at source under the Income Tax Act 1961. You are
            responsible for choosing between the old and new tax regimes, for making any
            investment declaration on time, and for the accuracy of what you declare. Where you
            make no declaration we will apply the default regime then in force. Professional tax
            is deducted where the State in which you work levies it.</p>

          <p><strong>11. Leave and holidays.</strong>
            Leave accrues under the company's leave policy and the Shops and Establishments
            legislation applicable to your location. The company publishes its holiday calendar
            before the start of each calendar year. Leave must be applied for and approved in
            advance except in an emergency, and unapproved absence is treated under clause 21.</p>

          <p><strong>12. Exclusivity of service.</strong>
            You will devote your working time to {{company_name}}. During your employment you may
            not, without our prior written consent, take other employment, engage in a business or
            consultancy, or hold an office - whether paid or honorary - which conflicts with your
            duties, competes with us, or draws on our confidential information. Consent will not
            be withheld unreasonably for an activity that does none of these things.</p>

          <p><strong>13. Conflict of interest.</strong>
            You must declare in writing any personal, family or financial interest that could
            reasonably be seen to conflict with your duties, including a close relative employed
            by a competitor, customer or supplier. Declaring an interest is not an admission of
            wrongdoing; failing to declare one is a disciplinary matter.</p>

          <p><strong>14. Mobility.</strong>
            We may require you to work at any of our offices or client sites in India, or with an
            affiliated company, on the terms applicable at the time of transfer. We will give
            reasonable notice of a change of base location and will take your personal
            circumstances into account, but the requirement itself is a term of this contract.</p>

          <p><strong>15. Company property and information systems.</strong>
            Equipment, credentials, data and documents issued to you remain our property and must
            be returned on or before your last working day. Company systems may be monitored to
            the extent permitted by law for security, compliance and investigation of misconduct;
            you should not treat anything stored on them as private.</p>

          <p><strong>16. Confidentiality and intellectual property.</strong>
            Your obligations of confidentiality, and the assignment to us of intellectual property
            you create in the course of your employment, are set out in full in Annexure 6. Those
            obligations are a condition of this offer. The confidentiality obligations survive the
            end of your employment and continue indefinitely.</p>

          <p><strong>17. Non-solicitation.</strong>
            For twelve months after your employment ends you will not solicit any employee of
            {{company_name}} whom you worked with, or any customer you dealt with in your final
            twelve months, to leave or to move their business. This clause restrains solicitation
            only. It does not prevent you working for a competitor, and it does not prevent an
            employee or customer approaching you of their own accord.</p>

          <p><strong>18. Notice of termination.</strong>
            After confirmation, either party may end this contract on {{notice_period}} written
            notice. During probation the notice period is thirty days on either side. We may
            require you to serve your notice, to remain away from the workplace during it, or to
            pay salary in lieu; where you do not serve notice you are liable for salary in lieu
            for the unserved portion. Notice runs from the date the written notice is received.</p>

          <p><strong>19. Termination without notice.</strong>
            We may terminate without notice or payment in lieu for gross misconduct, including
            dishonesty, a material breach of the code of conduct in Annexure 4, unauthorised
            disclosure of confidential information, or conviction of an offence that makes your
            continued employment untenable. Termination under this clause does not affect salary
            already earned.</p>

          <p><strong>20. Effect of an adverse background check.</strong>
            Background verification is normally completed within sixty days of joining. If it
            reveals a material discrepancy between what you told us and what is verified -
            particularly as to qualifications, previous employment, dates of employment or reason
            for leaving - we may terminate your employment without notice. A discrepancy that is
            immaterial and honestly made will be raised with you and given a fair hearing before
            any decision is taken.</p>

          <p><strong>21. Unauthorised absence.</strong>
            Absence without approval or explanation for eight consecutive working days will be
            treated as abandonment of employment, after we have written to your last known address
            and given you seven days to respond. We will not treat absence as abandonment where
            you are unable to make contact for reasons beyond your control.</p>

          <p><strong>22. Retirement.</strong>
            You will retire at the end of the month in which you reach {{retirement_age}},
            determined by the date of birth in the documents you produce on joining. Re-engagement
            after retirement is at our discretion and on terms agreed at the time.</p>

          <p><strong>23. Medical fitness.</strong>
            You may be asked to undergo a pre-employment medical examination by a registered
            medical practitioner. The purpose is limited to confirming fitness for the role and
            any statutory requirement; the outcome is treated as health data under Annexure 5.</p>

          <p><strong>24. Grievances and discipline.</strong>
            The company's grievance procedure is open to you from your first day. Disciplinary
            action follows a process in which the allegation is put to you in writing, you are
            given an opportunity to respond, and the decision is communicated with reasons. You
            may appeal a disciplinary decision to a manager senior to the one who made it.</p>

          <p><strong>25. Policies.</strong>
            Company policies apply to your employment and are amended from time to time. Where an
            amendment materially affects your terms we will communicate it. Policies do not form
            part of this contract and, where a policy conflicts with this letter, this letter
            prevails.</p>

          <p><strong>26. Entire agreement.</strong>
            This letter and its annexures are the entire agreement between us and replace any
            earlier representation, whether written or oral, including anything said during the
            recruitment process. Nothing in this clause limits liability for fraud.</p>

          <p><strong>27. Severability.</strong>
            If any provision is found unenforceable, it is severed to the minimum extent necessary
            and the rest of the agreement continues in force. Where a restriction is
            unenforceable only because of its duration or scope, it applies with the longest
            duration or widest scope that would be enforceable.</p>

          <p><strong>28. Governing law and jurisdiction.</strong>
            This contract is governed by the laws of India. The courts at the seat of our
            registered office have jurisdiction, save that either party may seek urgent injunctive
            relief in any court of competent jurisdiction to protect confidential information or
            intellectual property.</p>

          <p><strong>29. Notices.</strong>
            Notices to you are validly given if sent to your registered email address or the
            postal address in our records. Notices to us must be sent to {{hr_contact_email}}. It
            is your responsibility to keep your contact details current in the HR system.</p>

          <p><strong>30. Variation.</strong>
            No change to these terms is effective unless in writing and signed on behalf of
            {{company_name}}. This does not prevent us making the operational changes this letter
            expressly permits, such as a change of duties, unit, reporting line or work location.</p>
        </div>
      </div>
`;

/**
 * Statutory benefits and deductions.
 *
 * Split from the terms because these are not things we are agreeing to - they
 * are things the law requires of us, and an employee reading their own offer is
 * entitled to see which statute each one comes from.
 */
export const OFFER_STATUTORY_BENEFITS = `
      <div class="section">
        <p class="section-title">Annexure 3 — Statutory benefits, retirals and deductions</p>
        <div class="section-body">
          <p>
            The following apply by operation of law. Where a threshold or rate is changed by
            statute, the changed figure applies from the date it takes effect without any
            amendment to this letter.
          </p>

          <p><strong>Provident fund.</strong>
            You will be enrolled under the Employees' Provident Funds and Miscellaneous Provisions
            Act 1952. {{company_name}} contributes {{employer_pf_contribution}} a year, being 12%
            of basic salary, and an equal member contribution is deducted from your salary. A part
            of the employer contribution is directed to the Employees' Pension Scheme 1995 as that
            scheme requires. Your Universal Account Number is portable between employers; you
            should carry forward an existing UAN rather than open a second one.</p>

          <p><strong>Gratuity.</strong>
            You are entitled to gratuity under the Payment of Gratuity Act 1972 on completion of
            five years of continuous service, calculated at fifteen days of last-drawn basic
            salary for each completed year. The provision of {{gratuity_provision}} shown in
            Annexure 1 is the annual accounting provision we make against that future liability.
            It is not an amount payable to you before the entitlement vests, and it is shown so
            that the cost-to-company figure is not overstated by concealing what it contains. The
            five-year requirement does not apply where service ends by death or disablement.</p>

          <p><strong>Employees' State Insurance.</strong>
            Where your wages fall within the wage ceiling prescribed under the Employees' State
            Insurance Act 1948, you and the company will contribute at the notified rates and you
            will be covered by the scheme's medical, sickness and disablement benefits. Where your
            wages exceed the ceiling the Act does not apply and the company's medical cover
            described below applies instead.</p>

          <p><strong>Bonus.</strong>
            Statutory bonus is payable under the Payment of Bonus Act 1965 to employees whose
            wages do not exceed the limit prescribed by that Act. Where you are eligible, any
            performance-linked payment made to you is adjusted against statutory bonus to the
            extent the Act permits, and you will receive whichever is higher.</p>

          <p><strong>Maternity benefit.</strong>
            {{maternity_leave_summary}} These entitlements arise under the Maternity Benefit Act
            1961 as amended in 2017, which provides twenty-six weeks of paid leave for the first
            two children and twelve weeks thereafter, twelve weeks for a commissioning or adopting
            mother, and protection against dismissal on grounds of pregnancy. Nothing in this
            letter reduces a statutory entitlement.</p>

          <p><strong>Health insurance.</strong>
            {{health_insurance_summary}}</p>

          <p><strong>Professional tax.</strong>
            Deducted monthly at the rate notified by the State in which you are based, and
            remitted on your behalf. The amount appears on your payslip.</p>

          <p><strong>Labour welfare fund.</strong>
            Where the State in which you work operates a labour welfare fund, the employee
            contribution is deducted at the notified rate and the company pays its share.</p>

          <p><strong>Other benefits.</strong>
            {{loan_policy_summary}} {{professional_membership_summary}}</p>
        </div>
      </div>
`;

/** Code of conduct, including the POSH Act statement an employer must make. */
export const OFFER_CODE_OF_CONDUCT = `
      <div class="section">
        <p class="section-title">Annexure 4 — Code of conduct and workplace policy</p>
        <div class="section-body">
          <p>
            You are required to read and comply with the company's code of conduct. The following
            summarises obligations that are conditions of employment rather than matters of
            guidance.
          </p>

          <p><strong>1. Integrity.</strong>
            You will act honestly in dealings with the company, its customers, suppliers and
            regulators. You will not falsify a record, a timesheet, an expense claim or a
            qualification.</p>

          <p><strong>2. Anti-bribery.</strong>
            You will not offer, give, solicit or accept a bribe, kickback or improper advantage,
            whether directly or through a third party, and whether or not the conduct is customary
            in the market concerned. This includes facilitation payments. Gifts and hospitality of
            more than nominal value must be declared.</p>

          <p><strong>3. Prevention of sexual harassment.</strong>
            {{company_name}} is required by the Sexual Harassment of Women at Workplace
            (Prevention, Prohibition and Redressal) Act 2013 to maintain a workplace free of
            sexual harassment, and has constituted an Internal Committee to receive and inquire
            into complaints. A complaint may be made to the Internal Committee, whose contact
            details are published internally and are available from {{hr_contact_email}}. The Act
            protects a complainant and any witness from retaliation, and retaliation is itself
            treated as gross misconduct. Sexual harassment is a ground for termination without
            notice under clause 19.</p>

          <p><strong>4. Non-discrimination.</strong>
            Employment decisions are made on merit. Discrimination or harassment on the grounds of
            sex, gender identity, religion, caste, disability, marital status, sexual orientation
            or place of origin is prohibited and is a disciplinary matter.</p>

          <p><strong>5. Information security and acceptable use.</strong>
            You will comply with the company's information security policy. You will not share
            credentials, disable a security control, connect an unauthorised device to company
            systems, or move company or customer data to a personal account or personal storage.
            You must report a suspected security incident promptly; reporting an incident you
            caused will be treated more leniently than concealing it.</p>

          <p><strong>6. Insider information.</strong>
            You will not deal in the securities of any company, nor pass information to another
            person to deal, on the basis of unpublished price-sensitive information obtained
            through your employment.</p>

          <p><strong>7. Public statements.</strong>
            You will not speak to the press or make a public statement on behalf of the company
            unless authorised. Personal social media use is your own, provided you do not present
            it as the company's position or disclose confidential information.</p>

          <p><strong>8. Substance misuse.</strong>
            You will not attend work impaired by alcohol or an unlawful substance where doing so
            affects your ability to work safely or competently.</p>

          <p><strong>9. Raising a concern.</strong>
            You may raise a concern about suspected wrongdoing through the company's whistleblowing
            channel, including anonymously. A person who raises a concern honestly is protected
            from detriment even if the concern turns out to be mistaken.</p>
        </div>
      </div>
`;

/** Data protection notice under the Digital Personal Data Protection Act 2023. */
export const OFFER_DATA_PROTECTION = `
      <div class="section">
        <p class="section-title">Annexure 5 — Personal data, and documents to produce on joining</p>
        <div class="section-body">
          <p><strong>How we handle your personal data.</strong>
            {{company_name}} processes your personal data as a Data Fiduciary under the Digital
            Personal Data Protection Act 2023.</p>

          <p><strong>What we process.</strong>
            Identity and contact details; government identifiers including PAN and Aadhaar;
            qualifications and employment history; bank account details; salary, tax and provident
            fund records; attendance and leave; performance records; and, where a role requires
            it, the outcome of a medical examination. Aadhaar is collected only where a statute or
            a scheme we are required to operate calls for it, and is not used for any other
            purpose.</p>

          <p><strong>Why we process it.</strong>
            To perform this contract of employment; to pay you and to meet our obligations for
            tax, provident fund and other statutory returns; to administer benefits; to manage
            performance; to keep the workplace secure; and to meet a legal or regulatory
            obligation. Where we rely on your consent, you may withdraw it, and we will tell you
            what the consequence of withdrawal is before you decide.</p>

          <p><strong>Who we share it with.</strong>
            Payroll and benefits providers, the background verification agency, the insurer
            administering medical cover, statutory authorities, and our professional advisers -
            each only to the extent needed for the purpose. We do not sell personal data.</p>

          <p><strong>How long we keep it.</strong>
            For the duration of your employment and afterwards only for as long as a statute
            requires or a claim may still be brought. Records kept solely for a statutory purpose
            are retained for the period that statute prescribes and then deleted.</p>

          <p><strong>Your rights.</strong>
            You may ask for a summary of the personal data we hold about you and how it is
            processed; ask us to correct data that is inaccurate, incomplete or out of date; ask
            for erasure where retention is no longer required; nominate a person to exercise these
            rights in the event of your death or incapacity; and complain to the Data Protection
            Board of India. Requests should be sent to {{hr_contact_email}}.</p>

          <p><strong>Documents to produce on your first day.</strong>
            {{documents_to_bring}} Originals are inspected and returned to you the same day; we
            retain copies only. Please bring:</p>
          <ul class="bullet">
            <li>PAN card. Salary cannot be processed without a PAN under the Income Tax Act 1961.</li>
            <li>Aadhaar card, or the enrolment acknowledgement.</li>
            <li>Proof of date of birth.</li>
            <li>Certificates and mark sheets for every qualification declared in your application.</li>
            <li>Relieving letter and experience letter from each previous employer.</li>
            <li>Payslips for the last three months of your most recent employment.</li>
            <li>Cancelled cheque or a bank statement showing your name, account number and IFSC.</li>
            <li>Universal Account Number, if you already hold one.</li>
            <li>Four passport-sized photographs.</li>
            <li>Passport, if held.</li>
            <li>A written explanation of any gap of more than six months in education or employment.</li>
          </ul>
          <p>
            If a document is genuinely unavailable on your joining date, tell {{hr_contact_name}}
            in advance. A document that is delayed and disclosed is an administrative matter; a
            document that is withheld engages clause 20.
          </p>
        </div>
      </div>
`;

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
            {{company_name}} on the terms set out in this letter and in Annexures A to H. I confirm
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
