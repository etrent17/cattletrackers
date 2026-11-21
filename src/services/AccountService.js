import { api } from "./CattleService.js";

// Calls for the signed-in user's own account. Errors are the same as CattleService's:
// they carry `status` (0 when the server could not be reached) and `sessionExpired`.
export class AccountService {
  async changePassword(currentPassword, newPassword) {
    return api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }
}
