import { NextResponse } from "next/server";
import { authorizeDrive } from "@/lib/drive/auth";
import { getDriveStorageLimit, getDriveStorageUsed } from "@/lib/drive/storage";

/** The signed-in user's Drive usage and cap, for the storage meter under the mail and admin menus. */
export async function GET(request: Request) {
	const auth = await authorizeDrive(request);
	if (auth.error) return auth.error;
	const { env, db, user } = auth;
	return NextResponse.json({ used: await getDriveStorageUsed(db, user.id), limit: await getDriveStorageLimit(env) });
}
