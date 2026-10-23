/** A fully simulated transfer. Names and addresses are fictional; nothing here touches a wallet or a network. */
export const FICTIONAL = {
  from: { name: 'Alex (fictional)', address: '0x1111…1111' },
  to: { name: 'Sam (fictional)', address: '0x2222…2222' },
  amountEth: '1',
  gas: 21000,
  baseFeeGwei: 10,
  tipGwei: 2,
  maxFeeGwei: 15,
};
export const FEE_ETH = '0.000252'; // 21,000 × (10 + 2) gwei
export const BASE_FEE_BURNED_ETH = '0.00021'; // 21,000 × 10 gwei
export const TIP_ETH = '0.000042'; // 21,000 × 2 gwei

export type Step = { id: string; title: string; text: string; status: string };
export const STEPS: Step[] = [
  {
    id: 'compose',
    title: 'Alex writes a transfer',
    status: 'Not sent yet',
    text: 'The transfer says: send 1 ETH from Alex’s address to Sam’s address. It carries a counter (nonce) so the same transfer cannot be replayed, a limit of 21,000 units of gas, and two fee settings Alex chooses: a tip of up to 2 gwei per unit of gas for the validator, and a maximum of 15 gwei per unit in total. The network, not Alex, sets the base fee. In this example it happens to be 10 gwei.',
  },
  {
    id: 'sign',
    title: 'Alex approves it',
    status: 'Not sent yet',
    text: 'In real life Alex’s wallet would show these details and ask for approval, then sign the transfer. Signing is the step that uses a private key, which is why Sola Lens never asks for one. Nothing is signed in this animation.',
  },
  {
    id: 'broadcast',
    title: 'The transfer is shared',
    status: 'Pending',
    text: 'The signed transfer is broadcast to the network and waits in a pool of other pending transfers. It has not happened yet. It can still be delayed or dropped.',
  },
  {
    id: 'included',
    title: 'A validator includes it in a block',
    status: 'Included in a block',
    text: 'A validator picks transfers from the pool, usually favouring higher tips, and executes them. The base fee is 10 gwei and the tip is 2 gwei, so the fee is 21,000 × 12 gwei. Alex’s account goes down by 1.000252 ETH and Sam’s goes up by 1 ETH. The tip of 0.000042 ETH goes to the validator and the base fee of 0.00021 ETH is burned. Alex’s 15 gwei maximum was not reached, so nothing extra is charged.',
  },
  {
    id: 'confirmed',
    title: 'More blocks build on top',
    status: 'Confirmed by later blocks',
    text: 'Each new block that builds on this one makes the transfer harder to undo. It is still not final.',
  },
  {
    id: 'final',
    title: 'The block is finalized',
    status: 'Finalized',
    text: 'After enough validators have voted for it, the block is finalized. At that point reversing it would require a severe network failure or an attack that destroys a very large amount of staked ETH, which is why it is treated as settled. If the amount matters, wait for this step.',
  },
];
