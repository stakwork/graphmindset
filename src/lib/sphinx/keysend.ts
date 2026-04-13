// eslint-disable-next-line @typescript-eslint/no-require-imports
const sphinx = require("sphinx-bridge")

export async function adminKeysend(destPubkey: string, amount: number): Promise<void> {
  // @ts-ignore
  let res = await sphinx.keysend(destPubkey, amount)

  if (!res?.success) {
    // @ts-ignore
    res = await sphinx.topup()
    if (!res?.budget || res.budget < amount) {
      throw new Error("Topup failed — insufficient budget")
    }
    // @ts-ignore
    res = await sphinx.keysend(destPubkey, amount)
    if (!res?.success) throw new Error("Keysend failed after topup")
  }
}
