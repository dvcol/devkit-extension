export interface Contribution { readonly id: string; readonly value: number; }
export function defineContribution<Value extends Contribution>(contribution: Value): Value {
  return contribution;
}
