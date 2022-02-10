/**
 * Solana Instructions layout specification
 * (copied from token-swap)
 *
 * @module
 */

import { blob, struct, u32, offset } from "@solana/buffer-layout";

/**
 * Layout for a public key
 */
export const publicKey = (property = "publicKey") => {
  return blob(32, property);
};

/**
 * Layout for a 64bit unsigned value
 */
export const uint64 = (property = "uint64") => {
  return blob(8, property);
};

/**
 * Layout for a Rust String type
 */
export const rustString = (property = "string") => {
  const rsl = struct<any>(
    [u32("length"), u32("lengthPadding"), blob(offset(u32(), -8), "chars")],
    property,
  );
  const _decode = rsl.decode.bind(rsl);
  const _encode = rsl.encode.bind(rsl);

  rsl.decode = (buffer: Buffer, offset: number) => {
    const data = _decode(buffer, offset);
    return data.chars.toString("utf8");
  };

  rsl.encode = (str: string, buffer: Buffer, offset: number) => {
    const data = {
      chars: Buffer.from(str, "utf8"),
    };
    return _encode(data, buffer, offset);
  };

  return rsl;
};
