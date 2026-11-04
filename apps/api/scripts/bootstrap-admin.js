/**
 * SMARTBIN - SECURE INITIAL ADMIN BOOTSTRAP SCRIPT
 *
 * Chỉ được thực thi khi cơ sở dữ liệu CHƯA CÓ bất kỳ tài khoản ADMIN nào.
 * Tuyệt đối không hardcode mật khẩu trong mã nguồn hoặc đưa vào Git.
 *
 * Cách sử dụng an toàn:
 *   ADMIN_USERNAME="admin" ADMIN_PASSWORD="<MatKhauManh123!>" node apps/api/scripts/bootstrap-admin.js
 */

import bcrypt from 'bcrypt';
import { PrismaClient, RoleName } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nạp file .env từ apps/api/.env nếu có
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Kiểm tra Demo Mode: Tuyệt đối từ chối chạy khi DEMO_MODE=true
if (process.env.DEMO_MODE === 'true') {
  console.error('[BOOTSTRAP REFUSED] Không được phép chạy Bootstrap khi DEMO_MODE=true.');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[BOOTSTRAP ERROR] Biến môi trường DATABASE_URL không tồn tại.');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

async function bootstrap() {
  console.log('====================================================');
  console.log('   SMARTBIN - SECURE ADMIN BOOTSTRAP WIZARD         ');
  console.log('====================================================\n');

  try {
    // 1. Kiểm tra an toàn: Đã có tài khoản ADMIN nào tồn tại chưa?
    const adminRoleExisting = await prisma.role.findUnique({
      where: { name: RoleName.ADMIN }
    });

    if (adminRoleExisting) {
      const existingAdminCount = await prisma.user.count({
        where: { roleId: adminRoleExisting.id }
      });

      if (existingAdminCount > 0) {
        console.error(
          `[BOOTSTRAP REFUSED] Thao tác bị từ chối! Đã tồn tại ${existingAdminCount} tài khoản ADMIN trong cơ sở dữ liệu.\n` +
          'Script này chỉ được phép chạy đúng 1 lần duy nhất khi cơ sở dữ liệu chưa có người quản trị.'
        );
        process.exit(1);
      }
    }

    // 2. Thu nhận thông tin đăng nhập từ biến môi trường (không hardcode)
    const username = (process.env.ADMIN_USERNAME || process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim();
    const displayName = (process.env.ADMIN_DISPLAY_NAME || 'Quản trị viên Hệ thống').trim();
    const password = process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!password) {
      console.error(
        '[BOOTSTRAP ERROR] Thiếu biến môi trường ADMIN_PASSWORD.\n' +
        'Vui lòng cung cấp mật khẩu quản trị qua biến môi trường (tối thiểu 8 ký tự):\n' +
        '  Ví dụ: ADMIN_PASSWORD="MySecurePassword123!" node apps/api/scripts/bootstrap-admin.js'
      );
      process.exit(1);
    }

    if (password.length < 8) {
      console.error('[BOOTSTRAP ERROR] Mật khẩu ADMIN_PASSWORD phải có độ dài tối thiểu 8 ký tự.');
      process.exit(1);
    }

    console.log(`[*] Băm mật khẩu an toàn với bcrypt (cost factor: 12)...`);
    const passwordHash = await bcrypt.hash(password, 12);

    console.log(`[*] Thực thi Transaction: Khởi tạo Roles và tạo tài khoản quản trị ban đầu [${username}]...`);
    const createdUser = await prisma.$transaction(async (tx) => {
      // Đảm bảo 3 vai trò chuẩn tồn tại trong Database
      const roles = [
        { name: RoleName.ADMIN, description: 'Quản trị viên toàn quyền hệ thống' },
        { name: RoleName.SUPERVISOR, description: 'Giám sát viên vận hành và khu vực' },
        { name: RoleName.WORKER, description: 'Nhân viên thu gom và xử lý rác' }
      ];

      for (const r of roles) {
        await tx.role.upsert({
          where: { name: r.name },
          create: r,
          update: { description: r.description }
        });
      }

      const adminRole = await tx.role.findUniqueOrThrow({
        where: { name: RoleName.ADMIN }
      });

      return await tx.user.create({
        data: {
          username,
          displayName,
          passwordHash,
          roleId: adminRole.id,
          isActive: true
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          createdAt: true
        }
      });
    });

    console.log('\n====================================================');
    console.log('   [SUCCESS] BOOTSTRAP TÀI KHOẢN ADMIN THÀNH CÔNG!  ');
    console.log('====================================================');
    console.log(`- User ID:      ${createdUser.id}`);
    console.log(`- Username:     ${createdUser.username}`);
    console.log(`- Display Name: ${createdUser.displayName}`);
    console.log(`- Role:         ADMIN (Quản trị viên)`);
    console.log(`- Created At:   ${createdUser.createdAt.toISOString()}`);
    console.log('----------------------------------------------------');
    console.log('LƯU Ý: Mật khẩu đã được băm an toàn và không lưu trữ thô.');
    console.log('Bạn có thể sử dụng thông tin này để đăng nhập vào trang Quản trị.\n');
  } catch (error) {
    console.error('[BOOTSTRAP FATAL ERROR]:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap();

