// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

export async function adminKeysend(destPubkey: string, amount: number, routeHint?: string): Promise<void> {
  let res = await sphinx.keysend(destPubkey, amount, routeHint)

  if (!res?.success) {
    res = await sphinx.topup()
    if (!res?.budget || res.budget < amount) {
      throw new Error("Topup failed — insufficient budget")
    }
    res = await sphinx.keysend(destPubkey, amount, routeHint)
    if (!res?.success) throw new Error("Keysend failed after topup")
  }
}
