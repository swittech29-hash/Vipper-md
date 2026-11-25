
export async function giftedAvailable() {
  return false;
}

export async function withGiftedFile() {
  throw new Error('Gifted backup is disabled.');
}
