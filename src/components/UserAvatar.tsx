import Image from 'next/image';

type UserAvatarProps = {
  src?: string | null;
  name?: string | null;
  className?: string;
};

export default function UserAvatar({ src, name, className = 'w-8 h-8' }: UserAvatarProps) {
  const initial = name?.trim().charAt(0).toUpperCase() || '用';

  return (
    <div className={`${className} rounded-full bg-brand-500 text-white flex items-center justify-center text-sm font-bold overflow-hidden flex-shrink-0`}>
      {src ? (
        <Image src={src} alt="账户头像" width={40} height={40} className="w-full h-full object-cover" unoptimized />
      ) : initial}
    </div>
  );
}
