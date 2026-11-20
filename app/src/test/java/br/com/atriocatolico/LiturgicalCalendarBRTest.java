package br.com.atriocatolico;

import org.junit.Test;
import static org.junit.Assert.*;
import static br.com.atriocatolico.LiturgicalCalendarBR.*;
import java.time.*;

public class LiturgicalCalendarBRTest {
    private Day d(String date) {return day(LocalDate.parse(date));}
    @Test public void publishedCoverageHasExactlyOneSeasonForEveryDay() {
        LocalDate first=LocalDate.parse("2026-11-18"), last=LocalDate.parse("2027-12-31");
        for(LocalDate date=first;!date.isAfter(last);date=date.plusDays(1)) {
            int count=0; for(Span s:TABLE) if(!date.isBefore(s.start) && !date.isAfter(s.end)) count++;
            assertEquals(date.toString(),1,count); assertNotEquals(Season.ATRIO,day(date).season);
        }
        assertEquals(Season.ATRIO,day(first.minusDays(1)).season); assertEquals(Season.ATRIO,day(last.plusDays(1)).season);
    }
    @Test public void boundariesInLocalTime() {
        String[] starts={"2026-11-29","2026-12-25","2027-01-11","2027-02-10","2027-03-26","2027-03-28","2027-05-17","2027-11-28","2027-12-25"};
        Season[] themes={Season.ADVENT,Season.CHRISTMAS,Season.ORDINARY,Season.LENT,Season.TRIDUUM,Season.EASTER,Season.ORDINARY,Season.ADVENT,Season.CHRISTMAS};
        for(int i=0;i<starts.length;i++) {
            LocalDate date=LocalDate.parse(starts[i]); ZonedDateTime previous=date.atStartOfDay(ZoneId.of("America/Fortaleza")).minusMinutes(1);
            assertNotEquals(themes[i],day(previous.toLocalDate()).season);
            assertEquals(themes[i],day(nextChange(previous).toLocalDate()).season);
        }
        assertEquals(d("2026-12-31").season,d("2027-01-01").season);
        ZonedDateTime midnight=ZonedDateTime.parse("2027-03-28T00:00:00-03:00[America/Fortaleza]");
        assertEquals(Season.TRIDUUM,day(midnight.withZoneSameInstant(ZoneId.of("America/Manaus")).toLocalDate()).season);
    }
    @Test public void precedenceAndTransfers() {
        assertTrue(d("2027-03-21").red); assertEquals(Season.LENT,d("2027-03-21").season); assertFalse(d("2027-03-22").red);
        assertEquals("Quinta-feira Santa",d("2027-03-25").feast); assertEquals(Season.LENT,d("2027-03-25").season);
        assertTrue(d("2027-03-26").red); assertEquals("Sábado Santo",d("2027-03-27").feast);
        assertEquals("Anunciação do Senhor",d("2027-04-05").feast); assertEquals("",d("2027-05-06").feast);
        assertEquals("Ascensão do Senhor",d("2027-05-09").feast); assertTrue(d("2027-05-16").red); assertEquals(Season.EASTER,d("2027-05-16").season);
        assertEquals("Epifania do Senhor",d("2027-01-03").feast); assertEquals("Batismo do Senhor",d("2027-01-10").feast);
    }
    @Test public void ambiguousOrMissingSeasonFailsClosedButUnknownFeastKeepsSeason() {
        LocalDate date=LocalDate.parse("2027-02-11"); Span a=new Span(date.toString(),date.toString(),Season.ADVENT), b=new Span(date.toString(),date.toString(),Season.LENT);
        assertEquals(Season.ATRIO,day(date,new Span[]{a,b}).season); assertEquals(Season.ATRIO,day(date,new Span[]{}).season);
        assertEquals(Season.LENT,day(date).season); assertEquals("",day(date).feast);
    }
    @Test public void greetingsAndWreath() {
        assertEquals("Boa noite",greeting(4)); assertEquals("Bom dia",greeting(5)); assertEquals("Bom dia",greeting(11));
        assertEquals("Boa tarde",greeting(12)); assertEquals("Boa tarde",greeting(17)); assertEquals("Boa noite",greeting(18));
        for(int h:new int[]{5,12,18}) {
            ZonedDateTime boundary=LocalDate.parse("2027-05-01").atTime(h,0).atZone(ZoneId.of("America/Fortaleza"));
            assertEquals(boundary,nextChange(boundary.minusSeconds(1)));
        }
        for(int i=0;i<4;i++) assertEquals(i+1,day(LocalDate.parse("2026-11-29").plusWeeks(i)).candles);
    }
}
