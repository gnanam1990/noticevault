/** Plain-language constraints for the corrected candidate; no transaction action. */
export function CapacityGuidance({renewal=false}:{renewal?:boolean}) {
 return <p className="my-3 text-sm text-slate-600" role="note">{renewal
  ? "Renewal may require claiming accrued provider earnings first. The claim pays the agreed provider. Wait for confirmation and refresh the review before renewing; repeated early prepayments can exceed the agreement limit."
  : "Corrected factory candidate: each agreement reserves 1 USDC of the 10 USDC factory limit. Twice the payment plus notice reserve must fit within 1 USDC (2A + R ≤ 1 USDC). For a notice period equal to the payment period, the payment can be at most 0.333333 USDC. Initial funding is only A + R; the reserved capacity is not an additional token charge. These rules are not yet deployed."}</p>;
}
