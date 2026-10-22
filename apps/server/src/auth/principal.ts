/**
 * Who a request acts for. Mawl has one owner and every profile, thread, run and event belongs to
 * them, so today there is one principal: a transport sets it only after the request presented the
 * launch or owner token. Paired devices (D8.1) will act for the owner too.
 */
export type Principal = Readonly<{ kind: 'owner' }>

export const OWNER: Principal = Object.freeze({ kind: 'owner' })
