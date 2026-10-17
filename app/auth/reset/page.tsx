import { redirect } from 'next/navigation';
export default function ResetPage(){ redirect('/login?mode=reset'); }
